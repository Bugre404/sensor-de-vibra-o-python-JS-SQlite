import streamlit as st
import serial
import pandas as pd
import sqlite3
from datetime import datetime
import threading
import time
import os
import plotly.graph_objects as go
from sklearn.ensemble import IsolationForest
import numpy as np

# --- CONFIGURAÇÕES ---
PORTA_SERIAL = 'COM4'
BAUD_RATE = 9600
DB_NAME = "dados_sensor.db"
INTERVALO_BACKUP_MINUTOS = 30

if not os.path.exists("backups"):
    os.makedirs("backups")

# --- ESTADO GLOBAL (Singleton para evitar conflito de portas entre abas) ---
@st.cache_resource
def get_shared_state():
    return {
        'ativo': False, 
        'porta': PORTA_SERIAL, 
        'erro': None, 
        'conectado': False,
        'debug_log': [],
        'heartbeat': time.time()
    }

global_state = get_shared_state()


# --- FUNÇÕES BANCO DE DADOS ---
def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    # Ativa o modo WAL para permitir leitura e escrita simultâneas
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute('''CREATE TABLE IF NOT EXISTS historico_vibracao
                      (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          data_hora TEXT,
                          millis INTEGER,
                          pico REAL,
                          media REAL
                      )''')
    conn.commit()
    conn.close()


def salvar_no_db(millis, pico, media):
    try:
        conn = sqlite3.connect(DB_NAME, timeout=20)
        cursor = conn.cursor()
        data_atual = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute("INSERT INTO historico_vibracao (data_hora, millis, pico, media) VALUES (?, ?, ?, ?)",
                       (data_atual, millis, pico, media))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Erro ao salvar no DB: {e}")
        return False


def realizar_backup_automatico():
    try:
        conn = sqlite3.connect(DB_NAME)
        df = pd.read_sql_query("SELECT * FROM historico_vibracao", conn)
        conn.close()
        if not df.empty:
            existentes = [f for f in os.listdir("backups") if f.startswith("analise")]
            proximo_id = len(existentes) + 1
            agora = datetime.now().strftime("%Y%m%d_%H%M%S")
            nome_arq = f"backups/analise{proximo_id}_{agora}.csv"
            df.to_csv(nome_arq, index=False)
    except:
        pass


# --- LEITURA SERIAL ROBUSTA ---
def ler_serial(state):
    init_db()
    print(f"--- Iniciando thread serial na porta {state['porta']} ---")
    while True:
        try:
            porta_atual = state['porta']
            # Timeout curto para permitir verificar mudança de porta no state
            with serial.Serial(porta_atual, BAUD_RATE, timeout=0.1) as ser:
                ser.dtr = True
                ser.rts = True
                state['erro'] = None
                state['conectado'] = True
                
                while state['porta'] == porta_atual:
                    state['heartbeat'] = time.time()
                    if ser.in_waiting > 0:
                        linha = ser.readline().decode('utf-8', errors='ignore').strip()
                        
                        if linha:
                            # Adiciona ao log de debug (mantém últimos 10)
                            state['debug_log'].append(f"[{datetime.now().strftime('%H:%M:%S')}] {linha}")
                            if len(state['debug_log']) > 10:
                                state['debug_log'].pop(0)
                            
                            # Gatilhos de Controle
                            if "--- MONITORAMENTO INICIADO ---" in linha:
                                state['ativo'] = True
                            elif "--- MONITORAMENTO PAUSADO ---" in linha:
                                state['ativo'] = False
                                realizar_backup_automatico()
                            
                            # Gatilho por Dados (Comma separated: millis, pico, media)
                            elif "," in linha:
                                partes = linha.split(',')
                                if len(partes) == 3:
                                    if salvar_no_db(int(partes[0]), int(partes[1]), float(partes[2])):
                                        state['ativo'] = True 
                    time.sleep(0.01)
                
                state['conectado'] = False
                state['ativo'] = False
        except Exception as e:
            state['ativo'] = False
            state['conectado'] = False
            state['erro'] = str(e)
            print(f"Erro Serial: {e}")
            time.sleep(2)


@st.cache_resource
def iniciar_servico_serial():
    thread = threading.Thread(target=ler_serial, args=(global_state,), daemon=True)
    thread.start()
    return True

iniciar_servico_serial()

# --- INTERFACE STREAMLIT ---
st.set_page_config(page_title="Vibração Industrial PRO", layout="wide")

# Sidebar com Status Moderno
with st.sidebar:
    st.header("⚙️ Painel de Controle")
    
    # Seletor de Porta Serial
    nova_porta = st.text_input("Porta Serial (Ex: COM4)", value=global_state['porta'])
    if nova_porta != global_state['porta']:
        global_state['porta'] = nova_porta
        global_state['ativo'] = False
        global_state['conectado'] = False
        st.rerun()

    # Exibição do Status
    if global_state['ativo']:
        st.success("🟢 CONECTADO - GRAVANDO")
    elif global_state['conectado']:
        st.warning("🟡 CONECTADO - AGUARDANDO SINAL")
    else:
        st.error("🔴 DESLIGADO")
        if global_state['erro']:
            st.caption(f"❌ Erro detectado:")
            st.code(global_state['erro'], language="text")
            st.info("💡 Dica: Verifique se o Monitor Serial do Arduino está fechado e se nenhuma outra aba do navegador está aberta com erro.")
            if st.button("🔄 Forçar Re-conexão"):
                global_state['erro'] = None
                st.rerun()

    # Seção de Debug
    with st.expander("🛠️ Debug Serial", expanded=False):
        st.caption(f"Heartbeat: {datetime.fromtimestamp(global_state['heartbeat']).strftime('%H:%M:%S')}")
        if global_state['debug_log']:
            for log in reversed(global_state['debug_log']):
                st.text(log)
        else:
            st.write("Nenhum dado recebido ainda.")
        
        if st.button("♻️ Reiniciar Serviço"):
            st.cache_resource.clear()
            st.rerun()

    st.divider()
    
    col_back, col_clear = st.columns(2)
    with col_back:
        if st.button("💾 Backup CSV"):
            realizar_backup_automatico()
            st.toast("Backup realizado!")
    with col_clear:
        if st.button("🗑️ Limpar"):
            conn = sqlite3.connect(DB_NAME)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM historico_vibracao")
            conn.commit()
            conn.close()
            st.rerun()

st.title("📊 Dashboard de Monitoramento")

try:
    conn = sqlite3.connect(DB_NAME)
    # Ler ordenado por ASC para calcular médias móveis corretamente
    df_completo = pd.read_sql_query("SELECT * FROM historico_vibracao ORDER BY id ASC", conn)
    conn.close()
    
    if not df_completo.empty:
        df_completo['data_hora'] = pd.to_datetime(df_completo['data_hora'])
        # --- FEATURE ENGINEERING ---
        janela = 60
        df_completo['media_movel'] = df_completo['media'].rolling(window=janela, min_periods=1).mean()
        df_completo['desvio_padrao'] = df_completo['media'].rolling(window=janela, min_periods=1).std().fillna(0)
        df_completo['pico_maximo'] = df_completo['pico'].rolling(window=janela, min_periods=1).max()
        
        # --- NORMALIZAÇÃO DO TEMPO (00:00) ---
        t_inicio = df_completo['data_hora'].min()
        df_completo['segundos'] = (df_completo['data_hora'] - t_inicio).dt.total_seconds()
        df_completo['tempo_decorrido'] = df_completo['segundos'].apply(lambda x: f"{int(x//60):02d}:{int(x%60):02d}")

        # --- MACHINE LEARNING (ISOLATION FOREST) ---
        if len(df_completo) > 60:
            features = ['media_movel', 'desvio_padrao', 'pico_maximo']
            modelo = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
            df_completo['anomalia'] = modelo.fit_predict(df_completo[features])
            # Forçar anomalia se o pico for extremo (fallback)
            df_completo.loc[df_completo['pico'] > 800, 'anomalia'] = -1
        else:
            df_completo['anomalia'] = 1 # Considera normal se não tiver dados suficientes
            
        # Reverte para DESC para facilitar a UI (o mais recente primeiro)
        df_completo = df_completo.iloc[::-1].reset_index(drop=True)
except:
    df_completo = pd.DataFrame()

# Layout Principal: Gauge e Gráfico
col_gauge, col_chart = st.columns([1, 2])

with col_gauge:
    st.subheader("Nível de Vibração")
    valor_atual = float(df_completo["media"].iloc[0]) if not df_completo.empty else 0
    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=valor_atual,
        gauge={
            'axis': {'range': [None, 1023]},
            'bar': {'color': "#31333F"},
            'steps': [
                {'range': [0, 300], 'color': "#00cc96"},
                {'range': [300, 700], 'color': "#f3f300"},
                {'range': [700, 1023], 'color': "#ef553b"}
            ],
        }
    ))
    fig.update_layout(height=300, margin=dict(l=20, r=20, t=30, b=20))
    st.plotly_chart(fig, width="stretch")
    
    # --- STATUS DE MACHINE LEARNING ---
    st.subheader("Status IA (Predição)")
    if not df_completo.empty and 'anomalia' in df_completo.columns:
        if df_completo['anomalia'].iloc[0] == -1:
            st.error("🚨 ANOMALIA DETECTADA! Possível desgaste.")
        else:
            st.success("✅ MÁQUINA OPERANDO NORMALMENTE")
    else:
        st.info("Coletando dados para análise IA...")

with col_chart:
    st.subheader("Tendência de Desgaste e Anomalias")
    if not df_completo.empty and 'media_movel' in df_completo.columns:
        # Pega os ultimos 200 pontos para o gráfico
        df_chart = df_completo.head(200).iloc[::-1]
        
        fig_trend = go.Figure()
        
        # Média Móvel
        fig_trend.add_trace(go.Scatter(
            x=df_chart['tempo_decorrido'], y=df_chart['media_movel'],
            mode='lines', name='Média Móvel (60s)', line=dict(color='#00cc96')
        ))
        
        # Faixa de Instabilidade (Desvio Padrão)
        fig_trend.add_trace(go.Scatter(
            x=df_chart['tempo_decorrido'], y=df_chart['media_movel'] + df_chart['desvio_padrao'],
            mode='lines', line=dict(width=0), showlegend=False
        ))
        fig_trend.add_trace(go.Scatter(
            x=df_chart['tempo_decorrido'], y=df_chart['media_movel'] - df_chart['desvio_padrao'],
            mode='lines', fill='tonexty', fillcolor='rgba(0, 204, 150, 0.1)', line=dict(width=0), name='Instabilidade'
        ))
        
        # Anomalias
        df_anom = df_chart[df_chart['anomalia'] == -1]
        if not df_anom.empty:
            fig_trend.add_trace(go.Scatter(
                x=df_anom['tempo_decorrido'], y=df_anom['media_movel'],
                mode='markers', name='Anomalia', marker=dict(color='red', size=8, symbol='x')
            ))
            
        fig_trend.update_layout(height=400, margin=dict(l=20, r=20, t=30, b=20),
                                paper_bgcolor='rgba(11, 15, 25, 0.8)', plot_bgcolor='rgba(11, 15, 25, 0.5)',
                                xaxis_title="Tempo Decorrido (MM:SS)")
        st.plotly_chart(fig_trend, width="stretch")

        # --- NOVO GRÁFICO DE PICOS ---
        st.subheader("Impactos Máximos (Picos de Vibração)")
        fig_picos = go.Figure()
        
        fig_picos.add_trace(go.Scatter(
            x=df_chart['tempo_decorrido'], y=df_chart['pico'],
            mode='lines', name='Impacto Instantâneo', line=dict(color='#651fff', width=1)
        ))
        
        # Linha de Alerta (opcional, ex: em 700)
        fig_picos.add_hline(y=700, line_dash="dash", line_color="red", annotation_text="Limite de Alerta")

        fig_picos.update_layout(height=300, margin=dict(l=20, r=20, t=30, b=20),
                                paper_bgcolor='rgba(11, 15, 25, 0.8)', plot_bgcolor='rgba(11, 15, 25, 0.5)',
                                xaxis_title="Tempo Decorrido (MM:SS)",
                                yaxis_title="Intensidade do Pico")
        st.plotly_chart(fig_picos, width="stretch")
    else:
        st.info("Aguardando sinal...")

st.divider()

# TABELA DE DADOS RECENTES
st.subheader("📋 Últimos Registros")
st.dataframe(df_completo.head(20), width="stretch")

st.divider()

# RECONSTRUÇÃO DA LISTA DE DOWNLOADS
st.subheader("📂 Arquivos Disponíveis para Download")
arquivos_lista = []
for f in os.listdir("backups"):
    if f.endswith('.csv'):
        caminho = os.path.join("backups", f)
        t_mod = os.path.getmtime(caminho)
        arquivos_lista.append({
            'nome': f,
            'raw_time': t_mod,
            'data': datetime.fromtimestamp(t_mod).strftime('%d/%m/%Y %H:%M:%S')
        })

if arquivos_lista:
    # Ordena: Mais recente primeiro
    arquivos_lista = sorted(arquivos_lista, key=lambda x: x['raw_time'], reverse=True)

    # Cabeçalho da Tabela
    c1, c2, c3 = st.columns([3, 2, 2])
    c1.write("**Nome do Arquivo**")
    c2.write("**Finalizado em**")
    c3.write("**Ações**")

    for item in arquivos_lista:
        row1, row2, row3 = st.columns([3, 2, 2])
        row1.write(f"📄 {item['nome']}")
        row2.write(item['data'])
        col_down, col_del = row3.columns(2)
        with col_down:
            with open(f"backups/{item['nome']}", "rb") as file_bin:
                st.download_button(
                    label="Baixar",
                    data=file_bin,
                    file_name=item['nome'],
                    mime="text/csv",
                    key=f"down_{item['nome']}"
                )
        with col_del:
            if st.button("Excluir", key=f"del_{item['nome']}", type="secondary"):
                os.remove(f"backups/{item['nome']}")
                st.rerun()
else:
    st.info("Nenhuma gravação finalizada ainda.")

time.sleep(1)
st.rerun()