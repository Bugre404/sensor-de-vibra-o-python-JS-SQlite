import sqlite3
import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
import plotly.graph_objects as go
import os

DB_NAME = "dados_sensor.db"

def carregar_dados():
    if not os.path.exists(DB_NAME):
        print(f"Banco de dados {DB_NAME} não encontrado.")
        return pd.DataFrame()
        
    conn = sqlite3.connect(DB_NAME)
    # Carrega todos os dados, ordenados por ID (cronológico)
    df = pd.read_sql_query("SELECT * FROM historico_vibracao ORDER BY id ASC", conn)
    conn.close()
    
    if df.empty:
        print("Banco de dados vazio.")
        return df
        
    df['data_hora'] = pd.to_datetime(df['data_hora'])
    return df

def engenhoca_features(df, janela=60):
    """
    Cria as features de tempo (rolling window)
    janela=60 significa 60 segundos (já que a captação é a 1Hz)
    """
    df_features = df.copy()
    
    # Média móvel das leituras
    df_features['media_movel'] = df_features['media'].rolling(window=janela, min_periods=1).mean()
    
    # Desvio padrão móvel (indica instabilidade/vibração irregular)
    df_features['desvio_padrao'] = df_features['media'].rolling(window=janela, min_periods=1).std().fillna(0)
    
    # Pico máximo na janela
    df_features['pico_maximo'] = df_features['pico'].rolling(window=janela, min_periods=1).max()
    
    return df_features

def treinar_modelo_e_prever(df):
    """
    Treina o modelo Isolation Forest e prevê anomalias nos dados
    """
    # Selecionar as features para o modelo
    features = ['media_movel', 'desvio_padrao', 'pico_maximo']
    X = df[features]
    
    # Contaminação = estimativa da proporção de outliers (ex: 2%)
    # Para testes, vamos usar um valor mais alto se não tivermos muitos dados anômalos
    modelo = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
    
    # Treina o modelo e já prevê (-1 é anomalia, 1 é normal)
    df['anomalia'] = modelo.fit_predict(X)
    
    return df, modelo

def plotar_resultados(df, fonte="dados_sensor.db (SQLite)"):

    """
    Gera um gráfico interativo mostrando os pontos anômalos
    """
    fig = go.Figure()

    # Linha do tempo: Média Móvel
    fig.add_trace(go.Scatter(
        x=df['data_hora'], 
        y=df['media_movel'],
        mode='lines',
        name='Tendência (Média Móvel)',
        line=dict(color='#00e5ff', width=3) # Cor Cyan do projeto
    ))

    # Área de instabilidade (Desvio Padrão)
    fig.add_trace(go.Scatter(
        x=df['data_hora'], 
        y=df['media_movel'] + df['desvio_padrao'],
        mode='lines',
        line=dict(width=0),
        showlegend=False
    ))
    fig.add_trace(go.Scatter(
        x=df['data_hora'], 
        y=df['media_movel'] - df['desvio_padrao'],
        mode='lines',
        fill='tonexty',
        fillcolor='rgba(0, 0, 255, 0.2)',
        line=dict(width=0),
        name='Variância (Instabilidade)'
    ))

    # Destacar as anomalias detectadas
    df_anomalias = df[df['anomalia'] == -1]
    fig.add_trace(go.Scatter(
        x=df_anomalias['data_hora'], 
        y=df_anomalias['media_movel'],
        mode='markers',
        name='Anomalia Detectada',
        marker=dict(color='#ff1744', size=10, symbol='x', line=dict(width=1, color='white')) # Cor Vermelha do projeto
    ))

    fig.update_layout(
        title={
            'text': f"Análise Preditiva de Vibração (Isolation Forest)<br><span style='font-size:12px;color:gray;'>Fonte: {fonte}</span>",
            'y': 0.95,

            'x': 0.5,
            'xanchor': 'center',
            'yanchor': 'top'
        },
        xaxis_title="Tempo",
        yaxis_title="Nível de Vibração",
        template="plotly_dark",
        hovermode="x unified"
    )
    
    # Salvar em HTML e abrir no navegador
    if not os.path.exists("relatorios"):
        os.makedirs("relatorios")
        
    agora = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
    arquivo_historico = f"relatorios/relatorio_{agora}.html"
    arquivo_atual = "relatorio_anomalias.html"
    
    fig.write_html(arquivo_historico)
    fig.write_html(arquivo_atual) # Mantém uma cópia do último para acesso rápido
    
    print(f"Gráfico gerado com sucesso!")
    print(f"Histórico: {arquivo_historico}")
    print(f"Último: {arquivo_atual}")

def gerar_relatorio(lista_csvs=None):
    if lista_csvs:
        print(f"1. Carregando dados de {len(lista_csvs)} arquivos CSV...")
        dfs = []
        for csv_nome in lista_csvs:
            caminho = os.path.join("backups", csv_nome)
            if os.path.exists(caminho):
                dfs.append(pd.read_csv(caminho))
        if not dfs:
            return False, "Nenhum arquivo válido selecionado."
        df_raw = pd.concat(dfs, ignore_index=True)
    else:
        print("1. Carregando dados do banco...")
        df_raw = carregar_dados()
    
    if len(df_raw) > 60:

        print(f"Dados carregados: {len(df_raw)} registros.")
        
        print("2. Aplicando Engenharia de Features...")
        df_features = engenhoca_features(df_raw)
        
        print("3. Treinando Modelo de Detecção de Anomalias...")
        df_resultado, _ = treinar_modelo_e_prever(df_features)
        
        print(f"Anomalias detectadas: {len(df_resultado[df_resultado['anomalia'] == -1])}")
        
        print("4. Gerando Gráfico...")
        fonte = "Arquivos CSV Selecionados" if lista_csvs else "dados_sensor.db (SQLite)"
        plotar_resultados(df_resultado, fonte=fonte)
        return True, f"Relatório gerado com {len(df_resultado[df_resultado['anomalia'] == -1])} anomalias."

    else:
        msg = "Dados insuficientes (mínimo 60 registros)."
        print(msg)
        return False, msg

if __name__ == "__main__":
    gerar_relatorio()
