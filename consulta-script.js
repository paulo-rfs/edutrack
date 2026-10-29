
// EDUTRACK - CONSULTA DE PRESENÇA

const FIREBASE_URL =
  "https://presenciometro-escolar-default-rtdb.firebaseio.com";

const el = (id) => document.getElementById(id);

let ultimaBusca = "";
let ocupada = false;

// ============================================
// NORMALIZAR NOME E UID
// ============================================

function nomeNormalizado(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ");
}

function uidNormalizado(v) {
  return String(v || "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
}

// ============================================
// FORMATAR DATA
// ============================================

function dataRegistro(r) {
  const n = Number(r.timestamp);

  if (
    Number.isFinite(n) &&
    n >= 1577836800000 &&
    n < Date.now() + 86400000
  ) {
    return new Date(n).toLocaleString("pt-BR");
  }

  return [r.data, r.hora].filter(Boolean).join(" ") ||
    "Não informado";
}

function ordem(r) {
  const n = Number(r.timestamp);

  return Number.isFinite(n) && n >= 1577836800000
    ? n
    : 0;
}

// ============================================
// MOSTRAR RESULTADOS
// ============================================

function mostrarResultados(lista) {
  const caixa = el("resultadoConsulta");
  caixa.replaceChildren();

  el("resumoConsulta").textContent =
    `${lista.length} registro(s) encontrado(s).`;

  if (!lista.length) {
    const p = document.createElement("p");

    p.className = "vazio";
    p.textContent =
      "Nenhum registro com esse nome completo ou UID.";

    caixa.append(p);
    return;
  }

  lista.slice(0, 30).forEach(r => {
    const item = document.createElement("article");
    item.className = "item-resultado";

    const info = document.createElement("div");
    const nome = document.createElement("strong");

    nome.textContent = r.nome || "DESCONHECIDO";

    const detalhes = document.createElement("small");

    detalhes.textContent =
      `${dataRegistro(r)} • UID: ${r.uid || "—"} • ${r.tipo || "—"}`;

    info.append(nome, detalhes);

    const etiqueta = document.createElement("span");

    etiqueta.className =
      "tag-status " +
      (r.status === "AUTORIZADO" ? "autorizado" : "negado");

    etiqueta.textContent = r.status || "SEM STATUS";

    item.append(info, etiqueta);
    caixa.append(item);
  });
}

// ============================================
// CONSULTAR FIREBASE
// ============================================

async function consultar(termo) {
  if (ocupada) return;

  ocupada = true;
  el("btnConsultar").disabled = true;

  el("statusConsulta").textContent =
    "Consultando o Firebase...";

  try {
    const resposta = await fetch(
      `${FIREBASE_URL}/registros.json`,
      { cache: "no-store" }
    );

    if (!resposta.ok) {
      throw new Error(`HTTP ${resposta.status}`);
    }

    const dados = await resposta.json();

    const nomeBusca = nomeNormalizado(termo);
    const uidBusca = uidNormalizado(termo);

    const lista = Object.entries(dados || {})
      .filter(([, r]) => r && typeof r === "object")
      .filter(([, r]) =>
        nomeNormalizado(r.nome) === nomeBusca ||
        (
          uidBusca.length >= 8 &&
          uidNormalizado(r.uid) === uidBusca
        )
      )
      .map(([id, r]) => ({ ...r, id }))
      .sort(
        (a, b) =>
          ordem(b) - ordem(a) ||
          b.id.localeCompare(a.id)
      );

    mostrarResultados(lista);

    ultimaBusca = termo;

    el("statusConsulta").textContent =
      `Consulta concluída às ${new Date().toLocaleTimeString("pt-BR")}.`;

  } catch (erro) {
    el("statusConsulta").textContent =
      `Erro ao consultar: ${erro.message}. Verifique as regras do Firebase.`;

    console.error(erro);

  } finally {
    ocupada = false;
    el("btnConsultar").disabled = false;
  }
}

// ============================================
// BUSCA
// ============================================

el("formConsulta").addEventListener("submit", evento => {
  evento.preventDefault();

  const busca = el("buscaAluno").value.trim();

  if (busca) {
    void consultar(busca);
  }
});

// Atualiza a consulta a cada 10 segundos.
setInterval(() => {
  if (
    ultimaBusca &&
    document.visibilityState === "visible"
  ) {
    void consultar(ultimaBusca);
  }
}, 10000);
