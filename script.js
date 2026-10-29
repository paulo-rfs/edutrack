
// EDUTRACK - PAINEL DA ESCOLA

const FIREBASE_URL = "https://presenciometro-escolar-default-rtdb.firebaseio.com";
const LIMITE_TELA = 200;

const el = (id) => document.getElementById(id);

let registros = [];
let carregando = false;
let apagando = false;

let porta = null;
let leitor = null;
let lendo = false;
let mensagens = [];

// ============================================
// MENSAGENS E STATUS
// ============================================

function avisar(texto, erro = false) {
  el("mensagemSistema").textContent = texto;
  el("mensagemSistema").className =
    "mensagem " + (erro ? "erro" : "ok");
}

function status(elemento, texto, tipo = "") {
  elemento.textContent = texto;
  elemento.className = "status " + tipo;
}

// ============================================
// DATA E HORA
// ============================================

function horaRegistro(r) {
  const numero = Number(r.timestamp);

  if (
    Number.isFinite(numero) &&
    numero >= 1577836800000 &&
    numero < Date.now() + 86400000
  ) {
    return new Date(numero).toLocaleString("pt-BR");
  }

  return [r.data, r.hora].filter(Boolean).join(" ") ||
    "Não informado";
}

function dataOrdenacao(r) {
  const n = Number(r.timestamp);

  return Number.isFinite(n) && n >= 1577836800000
    ? n
    : 0;
}

// ============================================
// TABELA
// ============================================

function celula(tr, valor) {
  const td = document.createElement("td");
  td.textContent = String(valor ?? "—");
  tr.append(td);

  return td;
}

function renderizar() {
  const busca = el("filtroBusca")
    .value.trim()
    .toLocaleLowerCase("pt-BR");

  const situacao = el("filtroStatus").value;

  const visiveis = registros.filter(r =>
    (situacao === "TODOS" || r.status === situacao) &&
    `${r.nome || ""} ${r.uid || ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(busca)
  );

  const corpo = el("tabelaRegistros");
  corpo.replaceChildren();

  if (!visiveis.length) {
    const tr = document.createElement("tr");

    celula(tr, "Nenhum registro encontrado.").colSpan = 5;
    tr.firstChild.className = "vazio";

    corpo.append(tr);
  } else {
    const fragmento = document.createDocumentFragment();

    visiveis.forEach(r => {
      const tr = document.createElement("tr");

      celula(tr, horaRegistro(r));
      celula(tr, r.nome || "DESCONHECIDO");
      celula(tr, r.uid);
      celula(tr, r.tipo);

      const td = document.createElement("td");
      const etiqueta = document.createElement("span");

      etiqueta.className =
        "tag-status " +
        (r.status === "AUTORIZADO"
          ? "autorizado"
          : r.status === "NEGADO"
            ? "negado"
            : "");

      etiqueta.textContent = r.status || "SEM STATUS";

      td.append(etiqueta);
      tr.append(td);
      fragmento.append(tr);
    });

    corpo.append(fragmento);
  }

  el("totalRegistros").textContent = registros.length;

  el("totalAutorizados").textContent =
    registros.filter(r => r.status === "AUTORIZADO").length;

  el("totalNegados").textContent =
    registros.filter(r => r.status === "NEGADO").length;

  el("ultimoAcesso").textContent =
    registros[0]?.nome || "—";

  el("infoTabela").textContent =
    `Mostrando ${visiveis.length} de ${registros.length} registros carregados (limite de ${LIMITE_TELA} na tela).`;
}

// ============================================
// CARREGAR FIREBASE
// ============================================

async function carregarRegistros() {
  if (carregando || apagando) return;

  carregando = true;
  el("btnAtualizar").disabled = true;

  try {
    const resposta = await fetch(
      `${FIREBASE_URL}/registros.json`,
      { cache: "no-store" }
    );

    if (!resposta.ok) {
      throw new Error(
        `Firebase retornou HTTP ${resposta.status}`
      );
    }

    const dados = await resposta.json();

    registros = Object.entries(dados || {})
      .filter(([, r]) => r && typeof r === "object")
      .map(([id, r]) => ({ ...r, id }))
      .sort(
        (a, b) =>
          dataOrdenacao(b) - dataOrdenacao(a) ||
          b.id.localeCompare(a.id)
      )
      .slice(0, LIMITE_TELA);

    renderizar();

    status(el("statusFirebase"), "Conectado", "ok");

    el("atualizadoEm").textContent =
      `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}`;

  } catch (erro) {
    console.error(erro);

    status(el("statusFirebase"), "Erro", "erro");

    avisar(
      `Falha ao carregar o Firebase: ${erro.message}. Confira as regras de leitura.`,
      true
    );

  } finally {
    carregando = false;
    el("btnAtualizar").disabled = false;
  }
}

// ============================================
// LIMPAR HISTORICO DO FIREBASE
// ============================================

async function limparHistorico() {
  if (apagando) return;

  const confirmacao = prompt(
    "ATENÇÃO: apagar TODOS os registros do Firebase é irreversível.\nDigite APAGAR para continuar:"
  );

  if (confirmacao !== "APAGAR") return;

  if (!confirm(
    "Confirma a exclusão de TODO o histórico do EduTrack no Firebase?"
  )) {
    return;
  }

  apagando = true;
  el("btnLimparHistorico").disabled = true;

  avisar("Apagando histórico do Firebase...");

  try {
    const resposta = await fetch(
      `${FIREBASE_URL}/registros.json`,
      { method: "DELETE" }
    );

    if (!resposta.ok) {
      throw new Error(
        `HTTP ${resposta.status}: ${await resposta.text()}`
      );
    }

    registros = [];
    renderizar();

    avisar(
      "Histórico apagado do Firebase. Novas leituras serão registradas normalmente."
    );

    await carregarAposExclusao();

  } catch (erro) {
    console.error(erro);

    avisar(
      `Não foi possível apagar: ${erro.message}. Verifique as permissões de escrita do Firebase.`,
      true
    );

  } finally {
    apagando = false;
    el("btnLimparHistorico").disabled = false;
  }
}

async function carregarAposExclusao() {
  el("atualizadoEm").textContent =
    `Histórico limpo às ${new Date().toLocaleTimeString("pt-BR")}`;
}

// ============================================
// MONITOR SERIAL
// ============================================

function log(mensagem) {
  mensagens.push(
    `[${new Date().toLocaleTimeString("pt-BR")}] ${mensagem}`
  );

  mensagens = mensagens.slice(-80);

  el("logSerial").textContent = mensagens.join("\n");
  el("logSerial").scrollTop = el("logSerial").scrollHeight;
}

function botoesSerial() {
  el("btnConectar").disabled = !!porta;
  el("btnDesconectar").disabled = !porta;

  status(
    el("statusSerial"),
    porta ? "Conectada" : "Desconectada",
    porta ? "ok" : ""
  );
}

// ============================================
// LER MENSAGENS DA ESP32
// ============================================

async function lerSerial() {
  const decodificador = new TextDecoder();
  let textoPendente = "";

  try {
    while (lendo && porta?.readable) {
      leitor = porta.readable.getReader();

      try {
        while (lendo) {
          const { value, done } = await leitor.read();

          if (done) break;

          textoPendente += decodificador.decode(
            value,
            { stream: true }
          );

          const linhas = textoPendente.split(/\r?\n/);
          textoPendente = linhas.pop() || "";

          linhas.forEach(linha => {
            if (linha.trim()) log(linha.trim());
          });
        }

      } finally {
        leitor.releaseLock();
        leitor = null;
      }
    }

  } catch (erro) {
    if (lendo) {
      log(`Erro de leitura: ${erro.message}`);
    }

  } finally {
    lendo = false;

    if (porta) {
      try {
        await porta.close();
      } catch (erro) {
        console.warn(erro);
      }

      porta = null;
    }

    botoesSerial();
    log("Porta serial desconectada.");
  }
}

// ============================================
// CONECTAR ESP32
// ============================================

async function conectarESP32() {
  if (!("serial" in navigator)) {
    avisar(
      "Este navegador não permite Web Serial. Abra o site em uma aba normal do Chrome/Edge no computador, usando HTTPS ou localhost.",
      true
    );

    return;
  }

  try {
    const selecionada = await navigator.serial.requestPort();

    await selecionada.open({
      baudRate: 115200
    });

    porta = selecionada;
    lendo = true;

    botoesSerial();

    avisar("ESP32 conectada. Monitor serial ativo.");
    log("ESP32 conectada em 115200 baud.");

    void lerSerial();

  } catch (erro) {
    if (erro.name !== "NotFoundError") {
      avisar(
        `Erro ao conectar: ${erro.message}. Feche o Monitor Serial da Arduino IDE.`,
        true
      );
    }
  }
}

// ============================================
// DESCONECTAR ESP32
// ============================================

async function desconectarESP32() {
  lendo = false;

  if (leitor) {
    try {
      await leitor.cancel();
    } catch (erro) {
      console.warn(erro);
    }
  }
}

// ============================================
// EVENTOS DOS BOTOES
// ============================================

el("filtroBusca").addEventListener(
  "input",
  renderizar
);

el("filtroStatus").addEventListener(
  "change",
  renderizar
);

el("btnAtualizar").addEventListener(
  "click",
  carregarRegistros
);

el("btnLimparHistorico").addEventListener(
  "click",
  limparHistorico
);

el("btnConectar").addEventListener(
  "click",
  conectarESP32
);

el("btnDesconectar").addEventListener(
  "click",
  desconectarESP32
);

el("btnLimparLog").addEventListener("click", () => {
  mensagens = [];

  el("logSerial").textContent =
    "Mensagens limpas. Aguardando novas leituras...";
});

// ============================================
// INICIAR
// ============================================

void carregarRegistros();

setInterval(carregarRegistros, 3000);
