// ============================================================
// CONFIGURACAO DO FIREBASE
// ============================================================
let FIREBASE_URL = 'https://presenciometro-escolar-default-rtdb.firebaseio.com';

// ============================================================
// VARIAVEIS GLOBAIS
// ============================================================
let logs = [], tags = [], totalAcessos = 0, ultimoAcesso = null, portaAberta = false;
let pollingInterval = null;
let port = null, reader = null, writer = null, keepReading = false, lineBuffer = '';

// ============================================================
// DOM ELEMENTOS
// ============================================================
const connectBtn = document.getElementById('connectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const logsBody = document.getElementById('logsBody');
const tagsList = document.getElementById('tagsList');
const totalTags = document.getElementById('totalTags');
const totalAcessosEl = document.getElementById('totalAcessos');
const ultimoAcessoEl = document.getElementById('ultimoAcesso');
const statusPortaEl = document.getElementById('statusPorta');
const togglePortaBtn = document.getElementById('togglePortaBtn');
const addTagBtn = document.getElementById('addTagBtn');
const novaTagUid = document.getElementById('novaTagUid');
const novaTagNome = document.getElementById('novaTagNome');
const firebaseStatusEl = document.getElementById('firebase-status');

// ============================================================
// BUSCAR DADOS DO FIREBASE (POLLING)
// ============================================================
function buscarDadosFirebase() {
  const url = FIREBASE_URL + '/registros.json';
  fetch(url)
    .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(data => {
      if (!data) return;
      const registros = Object.keys(data).map(k => data[k]).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      logs = registros.map((r, i) => ({
        id: i + 1,
        nome: r.nome || 'Desconhecido',
        uid: r.uid || '---',
        data: r.data || '',
        hora: r.hora || '',
        status: r.status || 'N/A',
        tipo: r.tipo || 'DESCONHECIDO'
      }));
      totalAcessos = logs.length;
      if (logs.length > 0 && logs[0].status === 'Autorizado') {
        ultimoAcesso = { nome: logs[0].nome, hora: logs[0].hora, data: logs[0].data, tipo: logs[0].tipo };
      }
      atualizarInterface();
      if (firebaseStatusEl) firebaseStatusEl.innerHTML = 'Firebase conectado (' + logs.length + ' registros)';
    })
    .catch(err => {
      console.error('Erro ao buscar Firebase:', err);
      if (firebaseStatusEl) firebaseStatusEl.innerHTML = 'Erro no Firebase. Tentando novamente...';
    });
}

// ============================================================
// INICIAR POLLING
// ============================================================
function iniciarPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  buscarDadosFirebase();
  pollingInterval = setInterval(buscarDadosFirebase, 3000);
  console.log('Polling do Firebase iniciado (a cada 3 segundos).');
}

// ============================================================
// ENVIAR DADOS PARA O FIREBASE
// ============================================================
function enviarParaFirebaseREST(uid, nome, status, tipo) {
  const agora = new Date();
  const dataStr = agora.toLocaleDateString('pt-BR');
  const horaStr = agora.toLocaleTimeString('pt-BR');
  const registro = { uid, nome, tipo: tipo || 'DESCONHECIDO', data: dataStr, hora: horaStr, status, timestamp: agora.getTime() };
  const id = Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const url = FIREBASE_URL + '/registros/' + id + '.json';
  return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registro) })
    .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(data => { console.log('Registro enviado! ID:', id); setTimeout(buscarDadosFirebase, 500); return data; })
    .catch(err => { console.error('Erro ao enviar:', err); throw err; });
}

// ============================================================
// TESTAR CONEXAO
// ============================================================
function testarConexaoFirebase() {
  return fetch(FIREBASE_URL + '/.json')
    .then(res => {
      if (res.ok) {
        console.log('Firebase conectado!');
        if (firebaseStatusEl) firebaseStatusEl.innerHTML = 'Firebase REST conectado!';
        window.firebasePronto = true;
        return true;
      }
      return false;
    })
    .catch(err => {
      console.error('Erro ao testar Firebase:', err);
      if (firebaseStatusEl) firebaseStatusEl.innerHTML = 'Firebase nao disponivel.';
      return false;
    });
}

// ============================================================
// REGISTRAR ACESSO (LOCAL)
// ============================================================
function registrarAcesso(nome, uid, status, tipo) {
  const agora = new Date();
  const dataStr = agora.toLocaleDateString('pt-BR');
  const horaStr = agora.toLocaleTimeString('pt-BR');
  logs.unshift({ id: logs.length + 1, nome, uid, data: dataStr, hora: horaStr, status, tipo: tipo || 'DESCONHECIDO' });
  totalAcessos++;
  if (logs.length > 100) logs.pop();
  if (status === 'Autorizado') ultimoAcesso = { nome, hora: horaStr, data: dataStr, tipo: tipo || 'DESCONHECIDO' };
  salvarDados();
  atualizarInterface();
  if (status === 'Autorizado' || status === 'Aberto manualmente') enviarParaFirebaseREST(uid, nome, status, tipo).catch(() => {});
}

// ============================================================
// ATUALIZAR INTERFACE
// ============================================================
function atualizarInterface() {
  if (tags.length === 0) tagsList.innerHTML = '<p style="color: #999;">Nenhum aluno cadastrado</p>';
  else tagsList.innerHTML = tags.map(t => `
    <div class="tag-item">
      <div class="tag-info">
        <span class="tag-nome"><i class="fas fa-user"></i> ${t.nome}</span>
        <span class="tag-uid">${t.uid}</span>
        <span class="tag-tipo" style="font-size:0.8rem;color:#888;">${t.tipo || 'DESCONHECIDO'}</span>
      </div>
      <button class="btn-remove" onclick="removerTag('${t.uid}')"><i class="fas fa-trash"></i> Remover</button>
    </div>
  `).join('');

  totalTags.textContent = tags.length;
  totalAcessosEl.textContent = totalAcessos;

  if (ultimoAcesso) ultimoAcessoEl.innerHTML = `<p><span class="nome"> ${ultimoAcesso.nome}</span> <span class="tipo" style="font-size:0.8rem;color:#888;">(${ultimoAcesso.tipo || 'DESCONHECIDO'})</span><br><span class="hora"> ${ultimoAcesso.data} ${ultimoAcesso.hora}</span></p>`;
  else ultimoAcessoEl.innerHTML = '<p style="color: #999;">Nenhum registro</p>';

  atualizarStatusPorta();
  atualizarLogs();
}

function atualizarStatusPorta() {
  if (portaAberta) {
    statusPortaEl.innerHTML = '<p style="color: #f39c12;"> Porta ABERTA</p>';
    togglePortaBtn.innerHTML = '<i class="fas fa-lock"></i> Fechar Porta';
  } else {
    statusPortaEl.innerHTML = '<p style="color: #2ecc71;"> Porta FECHADA</p>';
    togglePortaBtn.innerHTML = '<i class="fas fa-unlock"></i> Abrir Porta';
  }
}

function atualizarLogs() {
  if (logs.length === 0) {
    logsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;">Nenhum registro</td></tr>';
    return;
  }
  logsBody.innerHTML = logs.map(log => `
    <tr>
      <td>${log.id}</td>
      <td><strong>${log.nome}</strong> <span style="font-size:0.7rem;color:#888;">(${log.tipo || 'DESCONHECIDO'})</span></td>
      <td style="font-family:monospace;">${log.uid}</td>
      <td>${log.data} ${log.hora}</td>
      <td><span class="status-badge ${log.status === 'Autorizado' ? 'success' : 'danger'}">${log.status}</span></td>
    </tr>
  `).join('');
}

// ============================================================
// PROCESSAR DADOS DO ARDUINO (SERIAL)
// ============================================================
function processarDado(linha) {
  console.log('Linha recebida:', linha);
  if (linha.includes('TAG:')) {
    const partes = linha.replace(/^TAG:\s*/, '').trim().split(':').map(p => p.trim());
    if (partes.length >= 4) {
      const [uid, nome, tipo, status] = partes;
      if (status.toUpperCase() === 'AUTORIZADO') registrarAcesso(nome, uid, 'Autorizado', tipo);
      else registrarAcesso('Desconhecido', uid, 'Negado', 'DESCONHECIDO');
    }
    return;
  }
  if (linha.includes('PORTA:')) {
    portaAberta = (linha.replace(/^PORTA:\s*/, '').trim().toUpperCase() === 'ABERTA');
    atualizarStatusPorta();
    return;
  }
}

// ============================================================
// LEITURA SERIAL
// ============================================================
async function lerDados(readerObj) {
  try {
    while (keepReading) {
      const { value, done } = await readerObj.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value, { stream: true });
      lineBuffer += chunk;
      while (lineBuffer.includes('\n')) {
        const idx = lineBuffer.indexOf('\n');
        const line = lineBuffer.substring(0, idx).trim();
        lineBuffer = lineBuffer.substring(idx + 1);
        if (line) processarDado(line);
      }
    }
  } catch (error) { if (error.name !== 'AbortError') console.error('Erro na leitura:', error); }
}

// ============================================================
// CONEXAO SERIAL
// ============================================================
async function conectarSerial() {
  try {
    if (port && port.readable) { await desconectarSerial(); return; }
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    const readerObj = port.readable.getReader();
    reader = readerObj;
    keepReading = true;
    lerDados(readerObj);
    const textEncoder = new TextEncoderStream();
    textEncoder.readable.pipeTo(port.writable);
    writer = textEncoder.writable.getWriter();
    connectBtn.innerHTML = '<i class="fas fa-plug"></i> Desconectar';
    connectBtn.className = 'btn btn-danger';
    connectionStatus.innerHTML = '<i class="fas fa-circle" style="color: #2ecc71;"></i> Conectado ao Arduino';
    togglePortaBtn.disabled = false;
  } catch (error) {
    console.error('Erro na conexao:', error);
    connectionStatus.innerHTML = '<i class="fas fa-circle" style="color: #e74c3c;"></i> Erro: ' + error.message;
    await desconectarSerial();
  }
}

async function desconectarSerial() {
  keepReading = false;
  if (reader) { try { await reader.cancel(); } catch (e) {} reader = null; }
  if (writer) { try { await writer.close(); } catch (e) {} writer = null; }
  if (port) { try { await port.close(); } catch (e) {} port = null; }
  lineBuffer = '';
  connectBtn.innerHTML = '<i class="fas fa-plug"></i> Conectar ao Arduino';
  connectBtn.className = 'btn btn-success';
  connectionStatus.innerHTML = '<i class="fas fa-circle" style="color: #e74c3c;"></i> Desconectado';
  togglePortaBtn.disabled = true;
}

async function enviarComando(cmd) {
  if (!writer) return;
  try { await writer.write(cmd + '\n'); } catch (e) { console.error('Erro ao enviar comando:', e); }
}

async function togglePorta() {
  if (!portaAberta) {
    await enviarComando('ABRIR');
    portaAberta = true;
    atualizarStatusPorta();
    registrarAcesso('Manual', 'Manual', 'Aberto manualmente', 'SISTEMA');
  } else {
    await enviarComando('FECHAR');
    portaAberta = false;
    atualizarStatusPorta();
  }
}

function adicionarTag() {
  const uid = novaTagUid.value.trim().toUpperCase();
  const nome = novaTagNome.value.trim();
  if (!uid || !nome) { alert('Preencha ambos!'); return; }
  if (tags.some(t => t.uid === uid)) { alert('Tag ja existe!'); return; }
  tags.push({ uid, nome, tipo: 'CADASTRADO' });
  salvarDados();
  atualizarInterface();
  novaTagUid.value = '';
  novaTagNome.value = '';
  enviarComando('ADD ' + uid + ' ' + nome);
  alert('Tag ' + nome + ' cadastrado!');
}

function removerTag(uid) {
  const tag = tags.find(t => t.uid === uid);
  if (!confirm('Remover ' + (tag ? tag.nome : uid) + '?')) return;
  tags = tags.filter(t => t.uid !== uid);
  salvarDados();
  atualizarInterface();
  enviarComando('REM ' + uid);
}

function salvarDados() {
  try { localStorage.setItem('rfid_dashboard', JSON.stringify({ tags, logs: logs.slice(0, 50), totalAcessos, ultimoAcesso })); } catch (e) {}
}

function carregarDados() {
  try {
    const dados = JSON.parse(localStorage.getItem('rfid_dashboard'));
    if (dados) {
      tags = dados.tags || [];
      logs = dados.logs || [];
      totalAcessos = dados.totalAcessos || 0;
      ultimoAcesso = dados.ultimoAcesso || null;
    }
  } catch (e) {}
}

// ============================================================
// LIMPAR BANCO DE DADOS (FIREBASE)
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  const limparFirebaseBtn = document.getElementById('limparFirebaseBtn');
  if (limparFirebaseBtn) {
    limparFirebaseBtn.addEventListener('click', function() {
      if (confirm('ATENCAO! Deseja limpar TODOS os registros do Firebase?\n\nIsso vai apagar os dados da NUVEM para TODOS os usuarios.\n\nEsta acao NAO pode ser desfeita!')) {
        if (confirm('ULTIMA CHANCE! Deseja realmente apagar TODOS os registros?')) {
          var confirmacao = prompt('Digite "SIM" para confirmar:');
          if (confirmacao === 'SIM') {
            const btn = limparFirebaseBtn;
            btn.innerHTML = 'Apagando...';
            btn.disabled = true;
            fetch(FIREBASE_URL + '/registros.json', { method: 'DELETE' })
              .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
              .then(() => { alert('Todos os registros foram removidos!'); localStorage.removeItem('rfid_dashboard'); location.reload(); })
              .catch(err => { alert('Erro ao limpar: ' + err.message); btn.innerHTML = 'Limpar Banco de Dados'; btn.disabled = false; });
          } else alert('Confirmacao cancelada.');
        }
      }
    });
  }
});

// ============================================================
// INICIALIZACAO
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  if (!('serial' in navigator)) {
    connectionStatus.innerHTML = 'Navegador nao suporta Web Serial. Use Chrome/Edge.';
    connectBtn.disabled = true;
  }
  carregarDados();
  atualizarInterface();
  testarConexaoFirebase().then(ok => {
    if (ok) iniciarPolling();
    else setTimeout(() => { testarConexaoFirebase().then(ok2 => { if (ok2) iniciarPolling(); }); }, 5000);
  });
  connectBtn.addEventListener('click', conectarSerial);
  togglePortaBtn.addEventListener('click', togglePorta);
  addTagBtn.addEventListener('click', adicionarTag);
  document.getElementById('limparLogsBtn')?.addEventListener('click', function() {
    if (confirm('Tem certeza que deseja limpar todo o historico?')) {
      if (confirm('Ultima chance! Deseja realmente apagar todos os registros?')) {
        logs = [];
        totalAcessos = 0;
        ultimoAcesso = null;
        salvarDados();
        atualizarInterface();
      }
    }
  });
  console.log('Sistema pronto!');
});