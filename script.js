// ==========================================================
// EDUTRACK - PAINEL DA ESCOLA (VS CODE / LIVE SERVER)
// Web Serial: Chrome ou Edge, em localhost ou HTTPS.
// ==========================================================
const FIREBASE_URL = "https://presenciometro-escolar-default-rtdb.firebaseio.com";
const INTERVALO_ATUALIZACAO = 3000;
const LIMITE_REGISTROS = 200;
const BAUD_RATE = 115200; // Mesmo valor de Serial.begin(115200) na ESP32

const el = {
  tabela: document.getElementById("tabelaRegistros"),
  busca: document.getElementById("filtroBusca"),
  filtro: document.getElementById("filtroStatus"),
  total: document.getElementById("totalRegistros"),
  autorizados: document.getElementById("totalAutorizados"),
  negados: document.getElementById("totalNegados"),
  ultimo: document.getElementById("ultimoAcesso"),
  firebase: document.getElementById("statusFirebase"),
  atualizado: document.getElementById("atualizadoEm"),
  info: document.getElementById("infoTabela"),
  atualizar: document.getElementById("btnAtualizar"),
  conectar: document.getElementById("btnConectar"),
  reconectar: document.getElementById("btnReconectar"),
  desconectar: document.getElementById("btnDesconectar"),
  serial: document.getElementById("statusSerial"),
  mensagemSerial: document.getElementById("mensagemSerial"),
  nomePorta: document.getElementById("nomePortaSerial"),
  log: document.getElementById("logSerial"),
  limparLog: document.getElementById("btnLimparLog"),
  ultimaTag: document.getElementById("ultimaTagSerial"),
  ultimoUID: document.getElementById("ultimoUidSerial"),
  ultimoStatus: document.getElementById("ultimoStatusSerial"),
  catraca: document.getElementById("statusCatraca")
};

let registros = [];
let atualizando = false;
let portaSerial = null;
let leitorSerial = null;
let tarefaLeitura = null;
let pararLeitura = false;
let conectando = false;
let desconectando = false;
let logLinhas = [];

// ==========================================================
// FIREBASE / HISTORICO
// ==========================================================
function indicador(elemento, mensagem, classe = "") {
  elemento.textContent = mensagem;
  elemento.className = `indicador ${classe}`.trim();
}

function formatarData(registro) {
  const numero = Number(registro.timestamp);
  // millis() da placa não representa data real.
  if (Number.isFinite(numero) && numero >= 1577836800000 && numero <= Date.now() + 86400000) {
    return new Date(numero).toLocaleString("pt-BR");
  }
  return [registro.data, registro.hora].filter(Boolean).join(" ") || "Sem data";
}

function ordenarRegistros(a, b) {
  const ta = Number(a.timestamp);
  const tb = Number(b.timestamp);
  const va = Number.isFinite(ta) && ta >= 1577836800000;
  const vb = Number.isFinite(tb) && tb >= 1577836800000;
  if (va && vb) return tb - ta;
  if (va !== vb) return va ? -1 : 1;
  return b.id.localeCompare(a.id, "pt-BR", { numeric: true });
}

function celula(linha, texto) {
  const td = document.createElement("td");
  td.textContent = String(texto ?? "—");
  linha.appendChild(td);
  return td;
}

function renderizarHistorico() {
  const busca = el.busca.value.trim().toLocaleLowerCase("pt-BR");
  const status = el.filtro.value;
  const filtrados = registros.filter(r => {
    const coincide = `${r.nome || ""} ${r.uid || ""}`.toLocaleLowerCase("pt-BR").includes(busca);
    return coincide && (status === "TODOS" || r.status === status);
  });

  el.tabela.replaceChildren();
  if (!filtrados.length) {
    const tr = document.createElement("tr");
    const td = celula(tr, "Nenhum registro encontrado.");
    td.colSpan = 5;
    td.className = "vazio";
    el.tabela.appendChild(tr);
  } else {
    const fragmento = document.createDocumentFragment();
    filtrados.forEach(r => {
      const tr = document.createElement("tr");
      celula(tr, formatarData(r));
      celula(tr, r.nome || "DESCONHECIDO");
      celula(tr, r.uid || "—");
      celula(tr, r.tipo || "—");
      const td = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "etiqueta " + (r.status === "AUTORIZADO" ? "autorizado" : r.status === "NEGADO" ? "negado" : "outro");
      badge.textContent = r.status || "SEM STATUS";
      td.appendChild(badge);
      tr.appendChild(td);
      fragmento.appendChild(tr);
    });
    el.tabela.appendChild(fragmento);
  }
  el.info.textContent = `Exibindo ${filtrados.length} de ${registros.length} registros carregados.`;
}

async function carregarFirebase() {
  if (atualizando) return;
  atualizando = true;
  el.atualizar.disabled = true;
  try {
    const url = `${FIREBASE_URL}/registros.json?orderBy=%22%24key%22&limitToLast=${LIMITE_REGISTROS}`;
    const resposta = await fetch(url, { cache: "no-store" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = await resposta.json();
    registros = Object.entries(dados || {})
      .filter(([, r]) => r && typeof r === "object")
      .map(([id, r]) => ({ ...r, id }))
      .sort(ordenarRegistros);

    el.total.textContent = registros.length;
    el.autorizados.textContent = registros.filter(r => r.status === "AUTORIZADO").length;
    el.negados.textContent = registros.filter(r => r.status === "NEGADO").length;
    el.ultimo.textContent = registros[0]?.nome || "—";
    renderizarHistorico();
    indicador(el.firebase, "Conectado", "ok");
    el.atualizado.textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}`;
  } catch (erro) {
    console.error("Erro ao ler Firebase:", erro);
    indicador(el.firebase, "Falha no Firebase", "erro");
    el.atualizado.textContent = "Verifique URL, internet e permissões do banco.";
  } finally {
    atualizando = false;
    el.atualizar.disabled = false;
  }
}

// ==========================================================
// MONITOR SERIAL: LOG E INTERPRETACAO DAS MENSAGENS DA ESP32
// ==========================================================
function log(mensagem) {
  const hora = new Date().toLocaleTimeString("pt-BR");
  logLinhas.push(`[${hora}] ${mensagem}`);
  logLinhas = logLinhas.slice(-120);
  el.log.textContent = logLinhas.join("\n");
  el.log.scrollTop = el.log.scrollHeight;
}

function interpretarLinha(linha) {
  log(linha);

  if (linha.startsWith("PORTA:")) {
    const aberta = linha.includes("ABERTA");
    indicador(el.catraca, aberta ? "Catraca: liberada" : "Catraca: travada", aberta ? "ok" : "");
  }

  if (linha.startsWith("TAG:")) {
    // TAG:UID:NOME:TIPO:AUTORIZADO
    // TAG:UID:DESCONHECIDO:NEGADO
    const partes = linha.split(":");
    const status = partes[partes.length - 1] || "—";
    const uid = partes[1] || "—";
    const nome = partes[2] || "DESCONHECIDO";
    el.ultimaTag.textContent = nome;
    el.ultimoUID.textContent = uid;
    el.ultimoStatus.textContent = status;
  }
}

function navegadorSuportaSerial() {
  if (!("serial" in navigator)) {
    indicador(el.serial, "Indisponível", "erro");
    el.mensagemSerial.textContent = "Web Serial não está disponível. Abra no Chrome ou Edge para computador, pelo Live Server.";
    return false;
  }
  if (!window.isSecureContext) {
    indicador(el.serial, "Página não segura", "erro");
    el.mensagemSerial.textContent = "Abra o site no Live Server: http://localhost:5500/index.html (ou em HTTPS).";
    return false;
  }
  return true;
}

function atualizarEstadoSerial(mensagem, tipo = "") {
  indicador(el.serial, mensagem, tipo);
  const ocupado = conectando || desconectando;
  el.conectar.disabled = ocupado || Boolean(portaSerial);
  el.reconectar.disabled = ocupado || Boolean(portaSerial);
  el.desconectar.disabled = ocupado || !portaSerial;
}

function descreverErroSerial(erro) {
  if (erro.name === "NotFoundError") {
    return "Nenhuma porta selecionada. Clique em Conectar e escolha a porta COM da ESP32.";
  }
  if (erro.name === "SecurityError") {
    return "O navegador bloqueou o acesso à porta. Use Chrome/Edge em localhost ou HTTPS e permita a conexão.";
  }
  if (erro.name === "InvalidStateError" || erro.name === "NetworkError") {
    return "A porta pode estar ocupada. Feche o Monitor Serial e o Plotter Serial da Arduino IDE, confira a USB e tente novamente.";
  }
  return `Erro ao conectar: ${erro.message || String(erro)}`;
}

// A chamada requestPort() ocorre diretamente após o clique.
// Isso é necessário para o navegador abrir a janela das portas COM.
async function conectarESP32() {
  if (portaSerial || conectando || desconectando || !navegadorSuportaSerial()) return;
  conectando = true;
  atualizarEstadoSerial("Escolhendo porta...");
  el.mensagemSerial.textContent = "Selecione a porta COM correspondente à ESP32 na janela do navegador.";
  try {
    const escolhida = await navigator.serial.requestPort();
    await abrirSerial(escolhida);
  } catch (erro) {
    const mensagem = descreverErroSerial(erro);
    log(mensagem);
    el.mensagemSerial.textContent = mensagem;
    atualizarEstadoSerial("Não conectado", "erro");
  } finally {
    conectando = false;
    if (!portaSerial) atualizarEstadoSerial("Desconectado");
    else atualizarEstadoSerial("Conectado", "ok");
  }
}

async function reconectarESP32() {
  if (portaSerial || conectando || desconectando || !navegadorSuportaSerial()) return;
  conectando = true;
  atualizarEstadoSerial("Reconectando...");
  try {
    const portas = await navigator.serial.getPorts();
    if (portas.length !== 1) {
      throw new Error(portas.length === 0
        ? "Não há porta autorizada. Use Conectar ESP32 para escolher a COM."
        : "Há mais de uma porta autorizada. Use Conectar ESP32 para escolher a correta.");
    }
    await abrirSerial(portas[0]);
  } catch (erro) {
    const mensagem = descreverErroSerial(erro);
    log(mensagem);
    el.mensagemSerial.textContent = mensagem;
  } finally {
    conectando = false;
    atualizarEstadoSerial(portaSerial ? "Conectado" : "Desconectado", portaSerial ? "ok" : "");
  }
}

async function abrirSerial(portaEscolhida) {
  // Não abrir a mesma porta duas vezes.
  if (portaSerial) return;
  await portaEscolhida.open({ baudRate: BAUD_RATE, bufferSize: 4096 });
  portaSerial = portaEscolhida;
  pararLeitura = false;
  const info = portaSerial.getInfo();
  el.nomePorta.textContent = info.usbVendorId
    ? `USB ${info.usbVendorId.toString(16).toUpperCase().padStart(4, "0")}:${(info.usbProductId || 0).toString(16).toUpperCase().padStart(4, "0")} (115200)`
    : "Porta serial selecionada (115200)";
  el.mensagemSerial.textContent = "Conectada! Aproxime uma tag RFID para testar a leitura.";
  indicador(el.serial, "Conectado", "ok");
  log("ESP32 conectada. Monitor serial iniciado em 115200 baud.");
  // Lê continuamente, sem bloquear os botões da página.
  tarefaLeitura = lerSerial(portaEscolhida);
}

async function lerSerial(porta) {
  const decoder = new TextDecoder();
  let parcial = "";
  try {
    while (!pararLeitura && porta.readable) {
      const leitor = porta.readable.getReader();
      leitorSerial = leitor;
      let leituraTerminou = false;
      try {
        while (!pararLeitura) {
          const { value, done } = await leitor.read();
          if (done) { leituraTerminou = true; break; }
          parcial += decoder.decode(value, { stream: true });
          const linhas = parcial.split(/\r?\n/);
          parcial = linhas.pop() || "";
          for (const linha of linhas) {
            if (linha.trim()) interpretarLinha(linha.trim().slice(0, 1000));
          }
          if (parcial.length > 3000) parcial = parcial.slice(-1000);
        }
      } catch (erro) {
        if (!pararLeitura) log(`Falha de leitura serial: ${erro.message}`);
        leituraTerminou = true;
      } finally {
        leitor.releaseLock();
        if (leitorSerial === leitor) leitorSerial = null;
      }
      if (leituraTerminou || pararLeitura) break;
    }
  } finally {
    if (parcial.trim()) interpretarLinha(parcial.trim().slice(0, 1000));
    try { await porta.close(); } catch (erro) { console.warn("Fechamento da porta:", erro); }
    if (portaSerial === porta) portaSerial = null;
    pararLeitura = false;
    desconectando = false;
    el.nomePorta.textContent = "Nenhuma selecionada";
    atualizarEstadoSerial("Desconectado");
    el.mensagemSerial.textContent = "Porta desconectada. Clique em Conectar ESP32 para continuar.";
    log("Monitor serial desconectado.");
  }
}

async function desconectarESP32() {
  if (!portaSerial || desconectando) return;
  desconectando = true;
  pararLeitura = true;
  atualizarEstadoSerial("Desconectando...");
  try {
    if (leitorSerial) await leitorSerial.cancel();
    if (tarefaLeitura) await tarefaLeitura;
  } catch (erro) {
    log(`Falha ao desconectar: ${erro.message}`);
  } finally {
    tarefaLeitura = null;
    desconectando = false;
    atualizarEstadoSerial(portaSerial ? "Conectado" : "Desconectado", portaSerial ? "ok" : "");
  }
}

// Se o cabo for removido, encerra a conexão com segurança.
if ("serial" in navigator) {
  navigator.serial.addEventListener("disconnect", event => {
    const removida = event.port || event.target;
    if (removida === portaSerial) {
      log("O dispositivo USB foi removido.");
      pararLeitura = true;
      if (leitorSerial) void leitorSerial.cancel().catch(() => {});
    }
  });
}

// ==========================================================
// EVENTOS
// ==========================================================
el.busca.addEventListener("input", renderizarHistorico);
el.filtro.addEventListener("change", renderizarHistorico);
el.atualizar.addEventListener("click", carregarFirebase);
el.conectar.addEventListener("click", conectarESP32);
el.reconectar.addEventListener("click", reconectarESP32);
el.desconectar.addEventListener("click", desconectarESP32);
el.limparLog.addEventListener("click", () => {
  logLinhas = [];
  el.log.textContent = "Monitor limpo. Aguardando novas mensagens...";
});

navegadorSuportaSerial();
void carregarFirebase();
setInterval(() => {
  if (document.visibilityState === "visible") void carregarFirebase();
}, INTERVALO_ATUALIZACAO);
