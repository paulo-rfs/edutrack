
 // EDUTRACK - PAINEL DA ESCOLA
// Este endereço é do projeto de demonstração informado no resumo do EduTrack.
const FIREBASE_URL = "https://presenciometro-escolar-default-rtdb.firebaseio.com";
const INTERVALO_ATUALIZACAO = 3000;
const LIMITE_REGISTROS = 200;

const elementos = {
  tabela: document.getElementById("tabelaRegistros"),
  busca: document.getElementById("filtroBusca"),
  filtroStatus: document.getElementById("filtroStatus"),
  total: document.getElementById("totalRegistros"),
  autorizados: document.getElementById("totalAutorizados"),
  negados: document.getElementById("totalNegados"),
  ultimo: document.getElementById("ultimoAcesso"),
  firebase: document.getElementById("statusFirebase"),
  atualizado: document.getElementById("atualizadoEm"),
  info: document.getElementById("infoTabela"),
  atualizar: document.getElementById("btnAtualizar"),
  conectar: document.getElementById("btnConectar"),
  desconectar: document.getElementById("btnDesconectar"),
  serial: document.getElementById("statusSerial"),
  log: document.getElementById("logSerial"),
  limparLog: document.getElementById("btnLimparLog")
};

let registros = [];
let atualizando = false;
let portaSerial = null;
let leitorSerial = null;
let lendoSerial = false;
let linhasLog = [];

function mudarIndicador(elemento, mensagem, tipo = "") {
  elemento.textContent = mensagem;
  elemento.className = `indicador ${tipo}`.trim();
}

function horarioRegistro(registro) {
  const numero = Number(registro.timestamp);
  // O código antigo da ESP32 usava millis(): isso NÃO é uma data real.
  if (Number.isFinite(numero) && numero >= 1577836800000 && numero <= Date.now() + 86400000) {
    return new Date(numero).toLocaleString("pt-BR");
  }
  return [registro.data, registro.hora].filter(Boolean).join(" ") || "Não informado";
}

function ordenarRegistros(a, b) {
  const ta = Number(a.timestamp);
  const tb = Number(b.timestamp);
  const validoA = ta >= 1577836800000;
  const validoB = tb >= 1577836800000;
  if (validoA && validoB) return tb - ta;
  if (validoA !== validoB) return validoA ? -1 : 1;
  return b.id.localeCompare(a.id, "pt-BR", { numeric: true });
}

function criarCelula(linha, texto) {
  const celula = document.createElement("td");
  celula.textContent = String(texto ?? "—");
  linha.appendChild(celula);
  return celula;
}

function atualizarMetricas() {
  elementos.total.textContent = registros.length;
  elementos.autorizados.textContent = registros.filter(r => r.status === "AUTORIZADO").length;
  elementos.negados.textContent = registros.filter(r => r.status === "NEGADO").length;
  elementos.ultimo.textContent = registros[0]?.nome || "—";
}

function renderizarTabela() {
  const busca = elementos.busca.value.trim().toLocaleLowerCase("pt-BR");
  const situacao = elementos.filtroStatus.value;
  const filtrados = registros.filter(registro => {
    const correspondeBusca = `${registro.nome || ""} ${registro.uid || ""}`
      .toLocaleLowerCase("pt-BR").includes(busca);
    return correspondeBusca && (situacao === "TODOS" || registro.status === situacao);
  });

  elementos.tabela.replaceChildren();
  if (filtrados.length === 0) {
    const linha = document.createElement("tr");
    const celula = criarCelula(linha, "Nenhum registro encontrado.");
    celula.colSpan = 5;
    celula.className = "vazio";
    elementos.tabela.appendChild(linha);
  } else {
    const fragmento = document.createDocumentFragment();
    filtrados.forEach(registro => {
      const linha = document.createElement("tr");
      criarCelula(linha, horarioRegistro(registro));
      criarCelula(linha, registro.nome || "DESCONHECIDO");
      criarCelula(linha, registro.uid || "—");
      criarCelula(linha, registro.tipo || "—");
      const celulaStatus = document.createElement("td");
      const etiqueta = document.createElement("span");
      etiqueta.className = "etiqueta " + (registro.status === "AUTORIZADO" ? "autorizado" : registro.status === "NEGADO" ? "negado" : "outro");
      etiqueta.textContent = registro.status || "SEM STATUS";
      celulaStatus.appendChild(etiqueta);
      linha.appendChild(celulaStatus);
      fragmento.appendChild(linha);
    });
    elementos.tabela.appendChild(fragmento);
  }
  elementos.info.textContent = `Exibindo ${filtrados.length} de ${registros.length} registros carregados.`;
}

async function carregarRegistros() {
  if (atualizando) return;
  atualizando = true;
  elementos.atualizar.disabled = true;
  try {
    const url = `${FIREBASE_URL}/registros.json?orderBy=%22%24key%22&limitToLast=${LIMITE_REGISTROS}`;
    const resposta = await fetch(url, { cache: "no-store" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = await resposta.json();
    registros = Object.entries(dados || {})
      .filter(([, valor]) => valor && typeof valor === "object")
      .map(([id, valor]) => ({ ...valor, id }))
      .sort(ordenarRegistros);
    atualizarMetricas();
    renderizarTabela();
    mudarIndicador(elementos.firebase, "Conectado", "ok");
    elementos.atualizado.textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}`;
  } catch (erro) {
    console.error("Falha ao buscar registros:", erro);
    mudarIndicador(elementos.firebase, "Erro de conexão", "erro");
    elementos.atualizado.textContent = "Confira a URL e as regras do Firebase.";
    elementos.info.textContent = "Não foi possível atualizar. Os dados anteriores, se houver, continuam na tela.";
  } finally {
    atualizando = false;
    elementos.atualizar.disabled = false;
  }
}

function escreverLog(mensagem) {
  const horario = new Date().toLocaleTimeString("pt-BR");
  linhasLog.push(`[${horario}] ${mensagem}`);
  linhasLog = linhasLog.slice(-60);
  elementos.log.textContent = linhasLog.join("\n");
  elementos.log.scrollTop = elementos.log.scrollHeight;
}

function atualizarBotoesSerial() {
  elementos.conectar.disabled = Boolean(portaSerial);
  elementos.desconectar.disabled = !portaSerial;
  mudarIndicador(elementos.serial, portaSerial ? "Conectado" : "Desconectado", portaSerial ? "ok" : "");
}

async function iniciarLeituraSerial() {
  const decodificador = new TextDecoder();
  let pendente = "";
  try {
    while (lendoSerial && portaSerial?.readable) {
      leitorSerial = portaSerial.readable.getReader();
      try {
        while (lendoSerial) {
          const { value, done } = await leitorSerial.read();
          if (done) break;
          pendente += decodificador.decode(value, { stream: true });
          const linhas = pendente.split(/\r?\n/);
          pendente = linhas.pop() || "";
          linhas.forEach(linha => { if (linha.trim()) escreverLog(linha.trim()); });
        }
      } finally {
        leitorSerial.releaseLock();
        leitorSerial = null;
      }
    }
  } catch (erro) {
    if (lendoSerial) escreverLog(`Leitura encerrada: ${erro.message}`);
  } finally {
    lendoSerial = false;
    if (portaSerial) {
      try { await portaSerial.close(); } catch (erro) { console.warn(erro); }
      portaSerial = null;
    }
    atualizarBotoesSerial();
  }
}

async function conectarESP32() {
  if (!("serial" in navigator)) {
    alert("Use Chrome ou Edge no computador, com o site aberto pelo Live Server (localhost), para acessar a porta serial.");
    return;
  }
  try {
    const porta = await navigator.serial.requestPort();
    await porta.open({ baudRate: 115200 });
    portaSerial = porta;
    lendoSerial = true;
    escreverLog("ESP32 conectada. Escutando a porta serial...");
    atualizarBotoesSerial();
    void iniciarLeituraSerial();
  } catch (erro) {
    if (erro.name !== "NotFoundError") escreverLog(`Não foi possível conectar: ${erro.message}`);
  }
}

async function desconectarESP32() {
  lendoSerial = false;
  if (leitorSerial) {
    try { await leitorSerial.cancel(); } catch (erro) { console.warn(erro); }
  }
  escreverLog("Desconexão solicitada.");
}

elementos.busca.addEventListener("input", renderizarTabela);
elementos.filtroStatus.addEventListener("change", renderizarTabela);
elementos.atualizar.addEventListener("click", carregarRegistros);
elementos.conectar.addEventListener("click", conectarESP32);
elementos.desconectar.addEventListener("click", desconectarESP32);
elementos.limparLog.addEventListener("click", () => {
  linhasLog = [];
  elementos.log.textContent = "Nenhuma mensagem no monitor serial.";
});

void carregarRegistros();
setInterval(carregarRegistros, INTERVALO_ATUALIZACAO);
