from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import os
from datetime import datetime
from analise_ml import gerar_relatorio

app = FastAPI(title="PiezoVision API")

# Permitir CORS (caso acesse a página de outra porta)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_NAME = "dados_sensor.db"
BACKUPS_DIR = "backups"
RELATORIOS_DIR = "relatorios"

# Garantir que as pastas existam
for pasta in [BACKUPS_DIR, RELATORIOS_DIR, "web"]:
    if not os.path.exists(pasta):
        os.makedirs(pasta)

def init_db_wal():
    if os.path.exists(DB_NAME):
        conn = sqlite3.connect(DB_NAME)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.close()

init_db_wal()

# Endpoint para listar os backups
@app.get("/api/arquivos")
def listar_arquivos():
    if not os.path.exists(BACKUPS_DIR):
        return []
    
    arquivos = []
    files = [f for f in os.listdir(BACKUPS_DIR) if f.endswith('.csv')]
    
    # Ordenar por data de modificação para pegar a ordem cronológica real antes do reverse
    files_sorted = sorted(files, key=lambda f: os.path.getmtime(os.path.join(BACKUPS_DIR, f)))

    for i, f in enumerate(files_sorted):
        caminho = os.path.join(BACKUPS_DIR, f)
        t_mod = os.path.getmtime(caminho)
        
        # Tentar calcular duração lendo o CSV
        duracao_str = "Desconhecido"
        try:
            import pandas as pd
            df = pd.read_csv(caminho)
            if not df.empty and 'millis' in df.columns:
                segundos = (df['millis'].max() - df['millis'].min()) / 1000
                minutos = int(segundos // 60)
                restante = int(segundos % 60)
                duracao_str = f"{minutos:02d}:{restante:02d}"
        except:
            pass

        arquivos.append({
            'id': i + 1,
            'nome': f,
            'data_raw': t_mod,
            'data': datetime.fromtimestamp(t_mod).strftime('%d/%m/%Y %H:%M:%S'),
            'duracao': duracao_str
        })
            
    # Inverter para mostrar os mais recentes primeiro na tabela
    return sorted(arquivos, key=lambda x: x['data_raw'], reverse=True)

# Endpoint para baixar um CSV específico
@app.get("/api/arquivos/{nome_arquivo}")
def obter_arquivo(nome_arquivo: str):
    caminho = os.path.join(BACKUPS_DIR, nome_arquivo)
    if os.path.exists(caminho) and nome_arquivo.endswith('.csv'):
        return FileResponse(caminho, media_type="text/csv")
    raise HTTPException(status_code=404, detail="Arquivo não encontrado")

# Endpoint para excluir um CSV específico
@app.delete("/api/arquivos/{nome_arquivo}")
def excluir_arquivo(nome_arquivo: str):
    caminho = os.path.join(BACKUPS_DIR, nome_arquivo)
    if os.path.exists(caminho) and nome_arquivo.endswith('.csv'):
        try:
            os.remove(caminho)
            return {"status": "success", "message": "Arquivo excluído"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=404, detail="Arquivo não encontrado")


# Endpoint para dados do SQLite em tempo real
@app.get("/api/sqlite")
def obter_dados_sqlite(limite: int = 1000):
    if not os.path.exists(DB_NAME):
        raise HTTPException(status_code=404, detail="Banco de dados não encontrado")
        
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.execute("PRAGMA journal_mode=WAL;") # Garante WAL na conexão
        conn.row_factory = sqlite3.Row # Para retornar como dict
        cursor = conn.cursor()
        
        # Pega os N últimos registros
        cursor.execute(f"SELECT * FROM historico_vibracao ORDER BY id DESC LIMIT {limite}")
        linhas = cursor.fetchall()
        conn.close()
        
        # Reverte para ficar em ordem cronológica ASC
        dados = [dict(linha) for linha in linhas]
        dados.reverse()
        
        return JSONResponse(content=dados)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Servir a pasta estática "web" na rota raiz '/'
@app.get("/api/relatorios")
def listar_relatorios():
    if not os.path.exists("relatorios"):
        return []
    arquivos = []
    for f in os.listdir("relatorios"):
        if f.endswith(".html"):
            t_mod = os.path.getmtime(os.path.join("relatorios", f))
            arquivos.append({
                "nome": f,
                "data": datetime.fromtimestamp(t_mod).strftime('%d/%m/%Y %H:%M:%S'),
                "raw_time": t_mod
            })
    # Ordenar por mais recente
    return sorted(arquivos, key=lambda x: x['raw_time'], reverse=True)

from typing import List, Optional
from pydantic import BaseModel

class ReportRequest(BaseModel):
    arquivos: Optional[List[str]] = None

@app.post("/api/gerar-relatorio")
def trigger_gerar_relatorio(req: Optional[ReportRequest] = None):
    try:
        lista = req.arquivos if req else None
        sucesso, mensagem = gerar_relatorio(lista_csvs=lista)
        if sucesso:
            return {"status": "success", "message": mensagem}
        else:
            raise HTTPException(status_code=400, detail=mensagem)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# Montar pastas estáticas
if os.path.exists("relatorios"):
    app.mount("/relatorios", StaticFiles(directory="relatorios"), name="relatorios")

if os.path.exists("web"):
    app.mount("/", StaticFiles(directory="web", html=True), name="web")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
