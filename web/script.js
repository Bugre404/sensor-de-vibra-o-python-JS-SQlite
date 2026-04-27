document.addEventListener('DOMContentLoaded', () => {
    const selectionZone = document.getElementById('selection-section');
    const dashboard = document.getElementById('dashboard');
    const btnNovo = document.getElementById('btn-novo');
    
    // Elementos da API
    const csvList = document.getElementById('csv-list');
    const btnLoadCsv = document.getElementById('btn-load-csv');
    const btnSqlite = document.getElementById('btn-sqlite');

    // Elementos do KPI
    const kpiTotal = document.getElementById('kpi-total');
    const kpiPico = document.getElementById('kpi-pico');
    const kpiStatus = document.getElementById('kpi-status');

    let chartInstance = null;
    let picoChartInstance = null;

    // Paleta de Cores para Comparação
    const colors = [
        { border: '#00e5ff', bg: 'rgba(0, 229, 255, 0.4)' },
        { border: '#651fff', bg: 'rgba(101, 31, 255, 0.4)' },
        { border: '#00e676', bg: 'rgba(0, 230, 118, 0.4)' },
        { border: '#ffea00', bg: 'rgba(255, 234, 0, 0.4)' },
        { border: '#ff1744', bg: 'rgba(255, 23, 68, 0.4)' }
    ];

    // --- INICIALIZAR FUNDO 3D IMEDIATAMENTE ---
    initDottedSurface();

    // --- EFEITOS DE SCROLL (REVEAL) ---
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15
    };

    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    function triggerReveals() {
        const reveals = document.querySelectorAll('.reveal');
        reveals.forEach(el => {
            el.classList.remove('active'); // Reset for re-trigger
            revealObserver.observe(el);
        });
    }

    // Trigger initial reveals
    triggerReveals();

    // --- BAUHAUS CARD ROTATION ---
    function initCardRotation() {
        const cards = document.querySelectorAll('.bauhaus-card');
        cards.forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                const angle = Math.atan2(-x, y);
                card.style.setProperty("--rotation", angle + "rad");
            });
        });
    }

    initCardRotation();

    let currentFilesData = [];

    // --- INICIALIZAÇÃO E API ---
    async function fetchHomeFiles() {
        try {
            const response = await fetch('/api/arquivos');
            currentFilesData = await response.json();
            renderHomeCsvList();
        } catch (err) {
            csvList.innerHTML = '<div class="checkbox-item loading-text">Erro ao conectar na API</div>';
        }
    }

    function renderHomeCsvList() {
        const sortBy = document.getElementById('sort-home').value;
        let sortedData = [...currentFilesData];

        if (sortBy === 'recent') sortedData.sort((a, b) => b.data_raw - a.data_raw);
        else if (sortBy === 'oldest') sortedData.sort((a, b) => a.data_raw - b.data_raw);
        else if (sortBy === 'id') sortedData.sort((a, b) => a.id - b.id);
        else if (sortBy === 'duration') sortedData.sort((a, b) => b.duracao.localeCompare(a.duracao));

        csvList.innerHTML = '';
        if (sortedData.length === 0) {
            csvList.innerHTML = '<div class="checkbox-item loading-text">Nenhum backup encontrado</div>';
            return;
        }

        sortedData.forEach(arq => {
            const tr = document.createElement('tr');
            
            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" value="${arq.nome}" style="accent-color: var(--primary); width: 16px; height: 16px; cursor: pointer;">
                </td>
                <td style="color: var(--text-muted);">#${arq.id}</td>
                <td style="text-align: left; font-family: monospace; font-size: 0.8rem;">${arq.nome}</td>
                <td style="color: var(--success); font-weight: 600;">${arq.duracao}</td>
            `;
            
            // Permitir clicar na linha para marcar o checkbox
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TD') {
                     if (e.target.tagName !== 'INPUT') {
                        const cb = tr.querySelector('input');
                        cb.checked = !cb.checked;
                    }
                }
            });
            
            csvList.appendChild(tr);
        });
    }



    fetchHomeFiles();

    document.getElementById('sort-home').addEventListener('change', renderHomeCsvList);

    // --- EVENTOS ---

    // Carregar CSV(s) selecionado(s)
    btnLoadCsv.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#csv-list input[type="checkbox"]:checked');
        if (checkboxes.length === 0) {
            alert('Selecione pelo menos um arquivo para analisar ou comparar.');
            return;
        }

        const promises = Array.from(checkboxes).map(cb => {
            return new Promise((resolve, reject) => {
                Papa.parse('/api/arquivos/' + cb.value, {
                    download: true,
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    complete: function(results) {
                        resolve({ name: cb.value, data: results.data });
                    },
                    error: function(err) {
                        reject(err);
                    }
                });
            });
        });

        Promise.all(promises)
            .then(datasets => analyzeMultipleData(datasets))
            .catch(err => alert('Erro ao carregar arquivos: ' + err.message));
    });

    // Carregar dados ao vivo (SQLite) - Analisa 30 minutos (1800 segundos)
    btnSqlite.addEventListener('click', () => {
        fetch('/api/sqlite?limite=1800')
            .then(response => response.json())
            .then(data => {
                if (!data || data.length === 0) {
                    alert('Nenhum dado encontrado no banco de dados.');
                    return;
                }
                analyzeMultipleData([{ name: 'Tempo Real (SQLite)', data: data }]);
            })
            .catch(err => alert('Erro ao carregar dados do banco. A API está rodando?'));
    });

    // Reset para nova análise
    btnNovo.addEventListener('click', () => {
        dashboard.classList.remove('dashboard-visible');
        dashboard.classList.add('dashboard-hidden');
        selectionZone.style.display = 'block';
        setTimeout(triggerReveals, 100);
        setTimeout(initCardRotation, 100);
    });

    // --- LÓGICA DE COMPARAÇÃO (FEATURE ENGINEERING) ---
    function analyzeMultipleData(filesData) {
        let globalMaxLen = 0;
        let globalMaxPico = 0;
        let totalRecords = 0;
        let totalAnomalias = 0;

        const chartDatasets = [];
        const picoDatasets = [];

        // Para cada arquivo selecionado, preparamos uma curva
        filesData.forEach((fileObj, index) => {
            const data = fileObj.data;
            totalRecords += data.length;
            if (data.length > globalMaxLen) globalMaxLen = data.length;

            const rawMedia = [];
            const rawPico = [];
            data.forEach(row => {
                rawMedia.push(row.media || 0);
                rawPico.push(row.pico || 0);
                if ((row.pico || 0) > globalMaxPico) globalMaxPico = row.pico;
            });

            // Média Móvel
            const windowSize = 60;
            const mediaMovel = [];
            
            for (let i = 0; i < rawMedia.length; i++) {
                let sum = 0;
                let count = 0;
                let startIdx = Math.max(0, i - windowSize + 1);
                for (let j = startIdx; j <= i; j++) {
                    sum += rawMedia[j];
                    count++;
                }
                const avg = sum / count;
                mediaMovel.push(avg);

            // Anomalias (Pontos 'x' vermelhos)
            const anomaliaData = [];
            for (let i = 0; i < rawMedia.length; i++) {
                if (i > windowSize && rowPicoIsAnomalous(rawPico[i], mediaMovel[i], rawMedia, Math.max(0, i - windowSize + 1), i)) {
                    anomaliaData.push({ x: i, y: mediaMovel[i] });
                    totalAnomalias++;
                }
            }

            // Seleciona cor
            const colorObj = colors[index % colors.length];

            // Adiciona a Curva de Tendência ao Gráfico
            chartDatasets.push({
                label: filesData.length > 1 ? `Tendência: ${fileObj.name}` : `Média Móvel`,
                data: mediaMovel,
                borderColor: colorObj.border,
                backgroundColor: colorObj.bg,
                borderWidth: 3,
                fill: filesData.length === 1,
                tension: 0.4,
                pointRadius: 0,
                pointHitRadius: 10
            });

            // Anomalias (Pontos 'x' vermelhos)
            const anomaliaData = [];
            for (let i = 0; i < rawMedia.length; i++) {
                if (i > windowSize && rowPicoIsAnomalous(rawPico[i], mediaMovel[i], rawMedia, Math.max(0, i - windowSize + 1), i)) {
                    anomaliaData.push({ x: i, y: mediaMovel[i] });
                }
            }

            if (anomaliaData.length > 0) {
                chartDatasets.push({
                    label: filesData.length > 1 ? `Anomalias: ${fileObj.name}` : 'Anomalias Detectadas',
                    data: anomaliaData,
                    borderColor: '#ff1744',
                    backgroundColor: '#ff1744',
                    pointStyle: 'crossRot',
                    pointRadius: 8,
                    pointBorderWidth: 2,
                    showLine: false,
                    order: -1
                });
            }

            // Se for arquivo único, mostramos a linha de sinal bruto também
            if (filesData.length === 1) {
                chartDatasets.push({
                    label: 'Sinal Bruto (Média)',
                    data: rawMedia,
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    borderWidth: 1,
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0
                });
            }

            // Adiciona a curva de Picos para o gráfico secundário
            picoDatasets.push({
                label: filesData.length > 1 ? `Picos: ${fileObj.name}` : `Impactos (Pico)`,
                data: rawPico,
                borderColor: colorObj.border,
                backgroundColor: colorObj.bg,
                borderWidth: 1,
                fill: filesData.length === 1,
                tension: 0.2,
                pointRadius: 0
            });
        });

        // Cria o Eixo X Normalizado (Segundos/Minutos decorridos)
        const labels = [];
        for (let i = 0; i < globalMaxLen; i++) {
            const minutes = Math.floor(i / 60);
            const seconds = i % 60;
            labels.push(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        }

        updateUI(labels, chartDatasets, picoDatasets, totalRecords, globalMaxPico, totalAnomalias, filesData.length > 1);
    }

    function rowPicoIsAnomalous(currentPico, currentAvg, rawMediaArr, startIdx, currentIdx) {
        let mean = currentAvg;
        let sumSqr = 0;
        let n = currentIdx - startIdx + 1;
        for (let j = startIdx; j <= currentIdx; j++) {
            sumSqr += Math.pow(rawMediaArr[j] - mean, 2);
        }
        let stdDev = Math.sqrt(sumSqr / n);
        if (stdDev < 5) stdDev = 5;
        return (currentPico > mean + (stdDev * 5)) || (currentPico > 800);
    }

    // --- ATUALIZAÇÃO DE INTERFACE E GRÁFICOS ---
    function updateUI(labels, chartDatasets, picoDatasets, total, picoMax, anomaliasCount, isCompareMode) {
        showSection(dashboard);

        kpiTotal.innerText = total.toLocaleString();
        kpiPico.innerText = picoMax.toFixed(1);
        
        if (anomaliasCount > 0) {
            kpiStatus.innerText = isCompareMode ? `${anomaliasCount} PICOS ANÔMALOS` : 'ALERTA / ANOMALIA';
            kpiStatus.className = 'kpi-value danger';
        } else if (picoMax > 700) {
            kpiStatus.innerText = 'ATENÇÃO (PICO ALTO)';
            kpiStatus.className = 'kpi-value warning';
        } else {
            kpiStatus.innerText = 'NORMAL';
            kpiStatus.className = 'kpi-value success';
        }

        renderChart(labels, chartDatasets, picoDatasets, isCompareMode);
        
        // Dispara as animações de entrada para os elementos recém-mostrados
        setTimeout(triggerReveals, 100);
    }

    function renderChart(labels, datasetsMedia, datasetsPico, isCompareMode) {
        const ctxVib = document.getElementById('vibChart').getContext('2d');
        const ctxPico = document.getElementById('picoChart').getContext('2d');

        if (chartInstance) chartInstance.destroy();
        if (picoChartInstance) picoChartInstance.destroy();

        Chart.defaults.color = '#a0aec0';
        Chart.defaults.font.family = "'Outfit', sans-serif";

        // Gráfico de Média
        chartInstance = new Chart(ctxVib, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasetsMedia
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            color: '#ffffff'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 25, 0.95)',
                        titleColor: '#00e5ff',
                        bodyColor: '#ffffff',
                        titleFont: { size: 16, weight: '800', family: "'Outfit'" },
                        bodyFont: { size: 14, family: "'Outfit'" },
                        padding: 15,
                        borderColor: 'rgba(0, 229, 255, 0.2)',
                        borderWidth: 1,
                        displayColors: true,
                        callbacks: {
                            title: function(context) {
                                // Se houver apenas um dataset, mostra o valor direto no título
                                if (context.length === 1) {
                                    return "Valor: " + context[0].parsed.y.toFixed(3);
                                }
                                return "Comparativo de Valores";
                            },
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                label += context.parsed.y.toFixed(3);
                                return label;
                            }
                        }
                    },
                    title: {
                        display: isCompareMode,
                        text: 'Comparação de Tendências (Eixo de Tempo Sincronizado)',
                        color: '#ffffff',
                        font: { size: 16, weight: '400' },
                        padding: { bottom: 20 }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Tempo Decorrido (Min:Seg)', color: '#a0aec0' },
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        ticks: { maxTicksLimit: 15 }
                    },
                    y: {
                        title: { display: true, text: 'Média de Vibração', color: '#a0aec0' },
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        suggestedMin: 0
                    }
                }
            }
        });

        // Gráfico de Picos
        picoChartInstance = new Chart(ctxPico, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasetsPico
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, padding: 20, color: '#ffffff' }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(11, 15, 25, 0.95)',
                        titleColor: '#00e5ff',
                        bodyColor: '#ffffff',
                        titleFont: { size: 16, weight: '800', family: "'Outfit'" },
                        bodyFont: { size: 14, family: "'Outfit'" },
                        padding: 15,
                        borderColor: 'rgba(0, 229, 255, 0.2)',
                        borderWidth: 1,
                        callbacks: {
                            title: function(context) {
                                if (context.length === 1) {
                                    return "Pico: " + context[0].parsed.y.toFixed(3);
                                }
                                return "Comparativo de Picos";
                            },
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                label += context.parsed.y.toFixed(3);
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        ticks: { maxTicksLimit: 15 }
                    },
                    y: {
                        title: { display: true, text: 'Vibração Máxima (Pico)', color: '#a0aec0' },
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        suggestedMin: 0
                    }
                }
            }
        });
    }

    const tabHome = document.getElementById('tab-home');
    const tabSecoes = document.getElementById('tab-secoes');
    const tabRelatorios = document.getElementById('tab-relatorios');
    const secoesView = document.getElementById('secoes-view');
    const reportsView = document.getElementById('reports-view');
    const secoesList = document.getElementById('secoes-list');
    const reportsList = document.getElementById('reports-list');
    const btnBackHome = document.getElementById('btn-back-home');
    const btnBackHomeSecoes = document.getElementById('btn-back-home-secoes');
    const btnGenerateReport = document.getElementById('btn-generate-report');
    const reportViewer = document.getElementById('report-viewer-container');
    const reportFrame = document.getElementById('report-frame');
    const btnCloseViewer = document.getElementById('btn-close-viewer');

    function showSection(section) {
        // Atualizar Indicador da Navbar
        document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        if (section === selectionZone) document.getElementById('tab-home').classList.add('active');
        if (section === reportsView) document.getElementById('tab-relatorios').classList.add('active');
        if (section === secoesView) document.getElementById('tab-secoes').classList.add('active');

        [selectionZone, dashboard, reportsView, secoesView].forEach(s => {

            s.classList.remove('dashboard-visible');
            s.classList.add('dashboard-hidden');
            s.style.display = 'none';
        });
        
        section.style.display = '';
        setTimeout(() => {
            section.classList.remove('dashboard-hidden');
            section.classList.add('dashboard-visible');
            triggerReveals();
        }, 10);
    }

    tabRelatorios.addEventListener('click', (e) => {
        e.preventDefault();
        showSection(reportsView);
        fetchReports();
    });

    tabSecoes.addEventListener('click', (e) => {
        e.preventDefault();
        showSection(secoesView);
        fetchSecoes();
    });

    tabHome.addEventListener('click', (e) => {
        e.preventDefault();
        showSection(selectionZone);
    });

    btnBackHome.addEventListener('click', () => showSection(selectionZone));
    btnBackHomeSecoes.addEventListener('click', () => showSection(selectionZone));

    btnGenerateReport.addEventListener('click', async () => {
        const selectedFiles = Array.from(document.querySelectorAll('#ai-file-selector input:checked')).map(cb => cb.value);
        
        btnGenerateReport.innerText = "⏳ Gerando...";
        btnGenerateReport.disabled = true;
        
        try {
            const res = await fetch('/api/gerar-relatorio', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ arquivos: selectedFiles.length > 0 ? selectedFiles : null })
            });
            const data = await res.json();
            if (res.ok) {
                alert("Sucesso: " + data.message);
                fetchReports(); // Atualiza a lista
            } else {
                alert("Erro: " + data.detail);
            }
        } catch (e) {
            alert("Erro de conexão com o servidor.");
        } finally {
            btnGenerateReport.innerText = "⚡ Gerar Novo Relatório";
            btnGenerateReport.disabled = false;
        }
    });


    async function fetchReports() {
        // Buscar lista de CSVs para o seletor
        try {
            const resCsv = await fetch('/api/arquivos');
            const csvs = await resCsv.json();
            const aiSelector = document.getElementById('ai-file-selector');
            aiSelector.innerHTML = csvs.map(arq => `
                <label class="checkbox-item">
                    <input type="checkbox" value="${arq.nome}">
                    <span>${arq.nome} (${arq.duracao})</span>
                </label>
            `).join('') || '<p class="loading-text">Nenhum CSV disponível.</p>';
        } catch(e) {}

        try {
            const res = await fetch('/api/relatorios');
            const data = await res.json();
            reportsList.innerHTML = data.map(repo => `
                <div class="report-item" onclick="viewReport('${repo.nome}')">
                    <h4>📄 ${repo.nome}</h4>
                    <p>Gerado em: ${repo.data}</p>
                </div>
            `).join('') || '<p class="loading-text">Nenhum relatório encontrado.</p>';
        } catch (e) {
            reportsList.innerHTML = '<p class="loading-text">Erro ao carregar relatórios.</p>';
        }
    }

    window.viewReport = function(nome) {
        reportFrame.src = `/relatorios/${nome}`;
        document.getElementById('viewing-report-title').innerText = `Visualizando: ${nome}`;
        reportViewer.style.display = 'block';
        reportViewer.scrollIntoView({ behavior: 'smooth' });
    };

    btnCloseViewer.addEventListener('click', () => {
        reportViewer.style.display = 'none';
        reportFrame.src = '';
    });


    let currentSecoesData = [];

    async function fetchSecoes() {
        const secoesTableBody = document.getElementById('secoes-list-body');
        try {
            const res = await fetch('/api/arquivos');
            currentSecoesData = await res.json();
            renderSecoesTable();
        } catch (e) {
            secoesTableBody.innerHTML = '<tr><td colspan="5" class="loading-text">Erro ao carregar seções.</td></tr>';
        }
    }

    function renderSecoesTable() {
        const secoesTableBody = document.getElementById('secoes-list-body');
        const sortBy = document.getElementById('sort-secoes').value;
        
        let sortedData = [...currentSecoesData];
        if (sortBy === 'recent') sortedData.sort((a, b) => b.data_raw - a.data_raw);
        else if (sortBy === 'oldest') sortedData.sort((a, b) => a.data_raw - b.data_raw);
        else if (sortBy === 'id') sortedData.sort((a, b) => a.id - b.id);
        else if (sortBy === 'duration') sortedData.sort((a, b) => b.duracao.localeCompare(a.duracao));

        secoesTableBody.innerHTML = sortedData.map(arq => `
            <tr>
                <td>#${arq.id}</td>
                <td>${arq.data}</td>
                <td style="color: var(--text-muted); font-family: monospace;">${arq.nome}</td>
                <td style="color: var(--success); font-weight: 600;">${arq.duracao}</td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <a href="/api/arquivos/${arq.nome}" class="btn-download-small">Baixar</a>
                        <button onclick="confirmarExclusao('${arq.nome}')" class="btn-download-small" style="background: var(--danger); color: white;">Excluir</button>
                    </div>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="5" class="loading-text">Nenhuma seção encontrada.</td></tr>';
    }

    document.getElementById('sort-secoes').addEventListener('change', renderSecoesTable);

    window.confirmarExclusao = async function(nome) {
        if (!confirm(`Tem certeza que deseja excluir o arquivo ${nome}?`)) return;
        
        try {
            const res = await fetch(`/api/arquivos/${nome}`, { method: 'DELETE' });
            if (res.ok) {
                fetchSecoes(); // Recarrega a lista
            } else {
                const err = await res.json();
                alert("Erro ao excluir: " + err.detail);
            }
        } catch (e) {
            alert("Erro de conexão.");
        }
    };

    window.baixarCSV = function(nome) {
        window.open(`/api/arquivos/${nome}`, '_blank');
    };

    // --- DOTTED SURFACE (THREE.JS) CONFIGURAÇÃO ---

    function initDottedSurface() {
        const container = document.getElementById('dotted-surface');
        // Fallback para background estático se WebGL não estiver disponível
        if (!container || typeof THREE === 'undefined') {
            if (container) container.style.background = '#0b0f19';
            return;
        }

        const SEPARATION = 150;
        const AMOUNTX = 40;
        const AMOUNTY = 60;

        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0x0b0f19, 2000, 10000); // Cor de fundo do piezo

        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 10000);
        camera.position.set(0, 355, 1220);

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(scene.fog.color, 0);
        
        container.appendChild(renderer.domElement);

        const positions = [];
        const colors = [];
        const geometry = new THREE.BufferGeometry();

        for (let ix = 0; ix < AMOUNTX; ix++) {
            for (let iy = 0; iy < AMOUNTY; iy++) {
                const x = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
                const y = 0;
                const z = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;
                positions.push(x, y, z);
                
                // Usando a cor cyan do nosso tema
                colors.push(0, 0.9, 1); // R=0, G=0.9 (229), B=1 (255)
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 10,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            sizeAttenuation: true,
        });

        const points = new THREE.Points(geometry, material);
        scene.add(points);

        let count = 0;

        function animate() {
            requestAnimationFrame(animate);

            const positionAttribute = geometry.attributes.position;
            const posArray = positionAttribute.array;

            let i = 0;
            for (let ix = 0; ix < AMOUNTX; ix++) {
                for (let iy = 0; iy < AMOUNTY; iy++) {
                    const index = i * 3;
                    // Animando o eixo Y com ondas senoidais
                    posArray[index + 1] = Math.sin((ix + count) * 0.3) * 50 + Math.sin((iy + count) * 0.5) * 50;
                    i++;
                }
            }

            positionAttribute.needsUpdate = true;
            renderer.render(scene, camera);
            count += 0.1;
        }

        function handleResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        window.addEventListener('resize', handleResize);
        animate();
    }
});
