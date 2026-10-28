// EDUTRACK - CONSULTA PARA RESPONSÁVEIS (PROTÓTIPO)
// Para uso real é obrigatório exigir autenticação e autorização no servidor.
const FIREBASE_URL = "https://presenciometro-escolar-default-rtdb.firebaseio.com";

const form = document.getElementById("formConsulta");
const entrada = document.getElementById("buscaAluno");
const botao = document.getElementById("btnConsultar");
const statusConsulta = document.getElementById("statusConsulta");
const resumo = document.getElementById("resumoConsulta");
const resultado = document.getElementById("resultadoConsulta");

let ultimaBusca = "";
let consultando = false;

function normalizarNome(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizarUID(texto) {
  return String(texto || "").toUpperCase().replace(/[^A-F0-9]/g, "");
}

function formatarData(registro) {
  const numero = Number(registro.timestamp);
  if (Number.isFinite(numero) && numero >= 1577836800000 && numero <= Date.now() + 86400000) {
    return new Date(numero).toLocaleString("pt-BR");
  }
  return [registro.data, registro.hora].filter(Boolean).join(" ") || "Horário não informado";
}

function instanteValido(item) {
  const valor = Number(item.timestamp);
  return valor >= 1577836800000 ? valor : 0;
}

function mensagemVazia(texto) {
  const bloco = document.createElement("div");
  bloco.className = "estado-vazio";
  bloco.textContent = texto;
  resultado.replaceChildren(bloco);
}

function desenharResultado(registros) {
  resultado.replaceChildren();
  if (registros.length === 0) {
    resumo.textContent = "Nenhum registro correspondente.";
    mensagemVazia("Não foram encontrados registros com esse nome completo ou UID.");
    return;
  }
  const recentes = registros.slice(0, 20);
  resumo.textContent = `${registros.length} registro(s) encontrado(s). Exibindo até 20.`;

  recentes.forEach(registro => {
    const item = document.createElement("article");
    item.className = "item-registro";
    const informacoes = document.createElement("div");
    const nome = document.createElement("strong");
    nome.textContent = registro.nome || "DESCONHECIDO";
    const detalhes = document.createElement("p");
    detalhes.className = "detalhes";
    detalhes.textContent = `${formatarData(registro)} • UID: ${registro.uid || "—"} • ${registro.tipo || "—"}`;
    informacoes.append(nome, detalhes);

    const etiqueta = document.createElement("span");
    etiqueta.className = "etiqueta " + (registro.status === "AUTORIZADO" ? "autorizado" : registro.status === "NEGADO" ? "negado" : "outro");
    etiqueta.textContent = registro.status || "SEM STATUS";
    item.append(informacoes, etiqueta);
    resultado.appendChild(item);
  });
}

async function consultar(termo) {
  if (consultando) return;
  consultando = true;
  botao.disabled = true;
  statusConsulta.textContent = "Consultando o Firebase...";

  try {
    // Consulta simples para DEMONSTRAÇÃO; lê o conjunto de registros do protótipo.
    const resposta = await fetch(`${FIREBASE_URL}/registros.json`, { cache: "no-store" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = await resposta.json();
    const buscaNome = normalizarNome(termo);
    const buscaUID = normalizarUID(termo);
    const registros = Object.entries(dados || {})
      .filter(([, registro]) => registro && typeof registro === "object")
      .filter(([, registro]) => {
        const mesmoNome = normalizarNome(registro.nome) === buscaNome;
        const mesmoUID = buscaUID.length >= 8 && normalizarUID(registro.uid) === buscaUID;
        return mesmoNome || mesmoUID;
      })
      .map(([id, registro]) => ({ ...registro, id }))
      .sort((a, b) => {
        const diff = instanteValido(b) - instanteValido(a);
        return diff || b.id.localeCompare(a.id, "pt-BR", { numeric: true });
      });

    ultimaBusca = termo;
    desenharResultado(registros);
    statusConsulta.textContent = `Consulta concluída às ${new Date().toLocaleTimeString("pt-BR")}.`;
  } catch (erro) {
    console.error("Erro ao consultar:", erro);
    statusConsulta.textContent = "Não foi possível consultar. Verifique a conexão e as regras do Firebase.";
    resumo.textContent = "Erro na consulta.";
    mensagemVazia("Falha ao carregar os registros.");
  } finally {
    consultando = false;
    botao.disabled = false;
  }
}

form.addEventListener("submit", evento => {
  evento.preventDefault();
  const termo = entrada.value.trim();
  if (termo) void consultar(termo);
});

// Atualização automática somente depois que a pessoa faz uma consulta.
setInterval(() => {
  if (ultimaBusca && document.visibilityState === "visible") void consultar(ultimaBusca);
}, 10000);
