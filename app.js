/* ============================================================
   FarmaGuard — MVP Hackathon
   Arquitetura: SPA Vanilla JS, LocalStorage, OpenRouter opcional.
   Modo demonstração claramente identificado quando não há API.
   ============================================================ */

(function () {
  "use strict";

  // ---------- Constantes ----------
  const LS_KEY = "farmaguard_analyses_v1";
  const SS_KEY_API = "farmaguard_api_key";
  const SS_KEY_MODEL = "farmaguard_model";

  // ---------- Estado ----------
  let currentAnalysis = null;

  // ---------- Utilidades ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function nowISO() { return new Date().toISOString(); }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    } catch { return iso; }
  }

  function uid() {
    return "fg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- LocalStorage ----------
  function loadAnalyses() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveAnalyses(list) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.error("Falha ao salvar no LocalStorage:", e);
      return false;
    }
  }

  function addAnalysis(entry) {
    const list = loadAnalyses();
    list.unshift(entry);
    // Limita a 200 registros para evitar crescimento indefinido
    const trimmed = list.slice(0, 200);
    return saveAnalyses(trimmed);
  }

  function deleteAnalysis(id) {
    const list = loadAnalyses().filter(a => a.id !== id);
    return saveAnalyses(list);
  }

  function clearAllAnalyses() {
    try {
      localStorage.removeItem(LS_KEY);
      return true;
    } catch { return false; }
  }

  // ---------- Configurações ----------
  function getApiKey() { return sessionStorage.getItem(SS_KEY_API) || ""; }
  function setApiKey(k) {
    if (k) sessionStorage.setItem(SS_KEY_API, k);
    else sessionStorage.removeItem(SS_KEY_API);
  }
  function getModel() {
    return sessionStorage.getItem(SS_KEY_MODEL) || "google/gemini-2.0-flash-exp:free";
  }
  function setModel(m) { sessionStorage.setItem(SS_KEY_MODEL, m); }

  // ---------- UI: Tabs ----------
  function initTabs() {
    const tabs = $$(".tab");
    const panels = {
      analyze: $("#panel-analyze"),
      history: $("#panel-history"),
      settings: $("#panel-settings")
    };
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => {
          const active = t === tab;
          t.classList.toggle("active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        Object.entries(panels).forEach(([key, panel]) => {
          const active = key === target;
          panel.hidden = !active;
          panel.classList.toggle("active", active);
        });
        if (target === "history") renderHistory();
        if (target === "settings") syncSettingsUI();
      });
    });
  }

  // ---------- UI: Status ----------
  function showStatus(el, type, msg) {
    if (!el) return;
    el.hidden = false;
    el.className = "status " + type;
    el.textContent = msg;
  }

  function hideStatus(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  // ---------- Validação do formulário ----------
  function collectFormData() {
    const patientName = $("#patientName").value.trim();
    const medsRaw = $("#medications").value.trim();
    const conditions = $$('input[name="condition"]:checked').map(cb => cb.value);

    const errors = [];
    const nameField = $("#patientName");
    const medsField = $("#medications");

    nameField.classList.remove("error");
    medsField.classList.remove("error");

    if (!patientName) {
      errors.push("Informe uma identificação fictícia do paciente.");
      nameField.classList.add("error");
    }

    const lines = medsRaw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      errors.push("Informe pelo menos 2 medicamentos, um por linha.");
      medsField.classList.add("error");
    }

    return { patientName, medications: lines, conditions, errors };
  }

  // ---------- Prompt para a IA ----------
  function buildPrompt(patientName, medications, conditions) {
    const medsText = medications.map((m, i) => `${i + 1}. ${m}`).join("\n");
    const condText = conditions.length ? conditions.join("; ") : "Nenhuma condição adicional informada.";
    return `Você é um assistente de apoio à decisão em ENFERMAGEM, especializado em segurança medicamentosa de idosos na atenção primária. Você NÃO é médico, NÃO prescreve, NÃO ajusta doses e NÃO emite diagnósticos.

Paciente (identificação fictícia): ${patientName}
Condições relevantes: ${condText}

Lista de medicamentos em uso:
${medsText}

TAREFA:
Analise a lista acima e produza alertas de segurança medicamentosa estritamente dentro do escopo de apoio educacional à enfermagem. Identifique:
1. Possíveis interações medicamentosas clinicamente relevantes entre os itens listados.
2. Duplicidades terapêuticas (ex.: dois anti-inflamatórios não esteroidais, dois benzodiazepínicos).
3. Medicamentos que exigem cautela especial em idosos (com base em critérios gerais como Beers 2023), SEM afirmar que o paciente tem uma condição específica.
4. Orientações de enfermagem de baixo risco para cada achado (ex.: monitorar pressão arterial, orientar hidratação, comunicar o prescritor se surgirem tonturas ou quedas).

REGRAS OBRIGATÓRIAS:
- Classifique cada achado como "grave", "moderado" ou "informativo".
- "grave" = risco potencial de dano significativo que justifica comunicação imediata ao prescritor/enfermeiro responsável.
- "moderado" = requer monitoramento e orientação, mas não é uma emergência.
- "informativo" = informação útil para o cuidado, sem risco imediato.
- NÃO invente medicamentos que não estejam na lista fornecida.
- NÃO recomende iniciar, suspender ou alterar dose de qualquer medicamento.
- NÃO afirme diagnóstico.
- Para cada alerta, inclua uma "conduta_enfermagem" concreta e dentro do escopo da enfermagem.
- Se não houver achados relevantes, retorne uma lista com um único item informativo dizendo que não foram identificados riscos evidentes na lista fornecida, mantendo a recomendação de avaliação profissional.

FORMATO DE SAÍDA (JSON estrito, sem markdown, sem texto fora do JSON):
{
  "alertas": [
    {
      "nivel": "grave" | "moderado" | "informativo",
      "titulo": "string curta",
      "medicamentos_envolvidos": ["string", "..."],
      "descricao": "string",
      "conduta_enfermagem": "string"
    }
  ],
  "resumo_geral": "string curta"
}`;
  }

  // ---------- Chamada real ao OpenRouter ----------
  async function callOpenRouter(prompt, apiKey, model) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": window.location.href,
        "X-Title": "FarmaGuard MVP"
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "Você responde exclusivamente com JSON válido, sem markdown." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 1600
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Resposta vazia do modelo.");
    return content;
  }

  // ---------- Parsing da resposta JSON ----------
  function parseAIResponse(raw) {
    let cleaned = String(raw).trim();
    // Remove cercas de código markdown, se o modelo as inserir
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    // Tenta encontrar o primeiro objeto JSON
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.alertas)) {
      throw new Error("Formato de resposta inesperado.");
    }
    // Normaliza níveis
    parsed.alertas = parsed.alertas.map(a => ({
      nivel: ["grave", "moderado", "informativo"].includes(String(a.nivel || "").toLowerCase())
        ? String(a.nivel).toLowerCase()
        : "informativo",
      titulo: String(a.titulo || "Alerta"),
      medicamentos_envolvidos: Array.isArray(a.medicamentos_envolvidos) ? a.medicamentos_envolvidos.map(String) : [],
      descricao: String(a.descricao || ""),
      conduta_enfermagem: String(a.conduta_enfermagem || "Avaliar com o enfermeiro responsável.")
    }));
    return parsed;
  }

  // ============================================================
  // MODO DEMONSTRAÇÃO — simulação claramente identificada
  // ============================================================
  function runDemoAnalysis(medications, conditions) {
    const medsLower = medications.map(m => m.toLowerCase());
    const alerts = [];

    const findMed = (...terms) =>
      medsLower.filter(m => terms.some(t => m.includes(t)));

    const has = (term) => medsLower.some(m => m.includes(term));

    // Regra 1: AINE + outro AINE / duplicidade
    const aines = findMed("ibuprofeno", "diclofenaco", "naproxeno", "nimesulida", "piroxicam", "cetoprofeno", "ácido acetilsalicílico", "aas");
    if (aines.length >= 2) {
      alerts.push({
        nivel: "grave",
        titulo: "Duplicidade de anti-inflamatórios não esteroidais (AINEs)",
        medicamentos_envolvidos: aines,
        descricao: "O uso simultâneo de dois ou mais AINEs aumenta significativamente o risco de lesão renal, sangramento gastrointestinal e retenção hídrica, especialmente em idosos.",
        conduta_enfermagem: "Comunicar o prescritor ou farmacêutico responsável antes da próxima administração. Monitorar sinais de dor epigástrica, fezes escuras, redução do débito urinário e edema. Orientar o paciente a não usar anti-inflamatórios por conta própria."
      });
    } else if (aines.length === 1) {
      const outrosRisco = findMed("losartana", "enalapril", "captopril", "ramipril", "espironolactona", "furosemida", "hidroclorotiazida");
      if (outrosRisco.length >= 1) {
        alerts.push({
          nivel: "moderado",
          titulo: "AINE associado a anti-hipertensivo ou diurético",
          medicamentos_envolvidos: [...aines, ...outrosRisco],
          descricao: "AINEs podem reduzir o efeito anti-hipertensivo e, combinados com diuréticos ou IECA/BRA, aumentar o risco de lesão renal aguda e hipercalemia em idosos.",
          conduta_enfermagem: "Monitorar pressão arterial e questionar sobre redução do volume urinário. Orientar hidratação adequada, se não houver restrição. Comunicar o prescritor se houver tontura, edema ou queda do estado geral."
        });
      }
    }

    // Regra 2: Benzodiazepínico + outro depressor do SNC
    const benzos = findMed("clonazepam", "diazepam", "lorazepam", "alprazolam", "bromazepam");
    const outrosSNC = findMed("tramadol", "codeína", "morfina", "gabapentina", "pregabalina", "zolpidem", "fenobarbital");
    if (benzos.length && outrosSNC.length) {
      alerts.push({
        nivel: "grave",
        titulo: "Associação de depressores do sistema nervoso central",
        medicamentos_envolvidos: [...benzos, ...outrosSNC],
        descricao: "A combinação de benzodiazepínicos com outros depressores do SNC aumenta o risco de sedação excessiva, depressão respiratória, confusão mental e quedas em idosos.",
        conduta_enfermagem: "Avaliar nível de consciência, padrão respiratório e risco de queda em cada contato. Comunicar o prescritor sobre sonolência excessiva ou episódios de confusão. Orientar o cuidador a não deixar o paciente sozinho ao deambular."
      });
    }

    // Regra 3: Varfarina + AINE / antiagregante
    const varfarina = findMed("varfarina", "warfarina", "marevan");
    if (varfarina.length) {
      const interagentes = findMed("ibuprofeno", "diclofenaco", "naproxeno", "nimesulida", "aas", "ácido acetilsalicílico", "clopidogrel");
      if (interagentes.length) {
        alerts.push({
          nivel: "grave",
          titulo: "Varfarina associada a AINE ou antiagregante plaquetário",
          medicamentos_envolvidos: [...varfarina, ...interagentes],
          descricao: "A associação aumenta substancialmente o risco de sangramento grave. O risco é particularmente elevado em idosos com histórico de quedas ou fragilidade.",
          conduta_enfermagem: "Verificar com o paciente/cuidador a presença de sangramento gengival, equimoses, fezes escuras ou hematúria. Comunicar imediatamente o prescritor. Reforçar orientação sobre risco de quedas."
        });
      }
    }

    // Regra 4: IECA/BRA + espironolactona ou suplemento de potássio
    const iecaBra = findMed("losartana", "enalapril", "captopril", "ramipril", "valsartana", "telmisartana");
    const potassio = findMed("espironolactona", "cloreto de potássio", "kcl");
    if (iecaBra.length && potassio.length) {
      alerts.push({
        nivel: "moderado",
        titulo: "Risco de hipercalemia",
        medicamentos_envolvidos: [...iecaBra, ...potassio],
        descricao: "IECA/BRA associados a poupadores de potássio ou suplementos de potássio podem elevar o potássio sérico, com risco de arritmias, especialmente se houver insuficiência renal.",
        conduta_enfermagem: "Verificar se há exames recentes de potássio e função renal. Questionar sobre fraqueza muscular, palpitações ou parestesias. Comunicar o prescritor para avaliação laboratorial se esses sintomas surgirem."
      });
    }

    // Regra 5: Metformina + condição renal (se marcada)
    if (has("metformina") && conditions.includes("Insuficiência renal")) {
      alerts.push({
        nivel: "moderado",
        titulo: "Metformina em contexto de insuficiência renal",
        medicamentos_envolvidos: findMed("metformina"),
        descricao: "A metformina exige ajuste ou suspensão em caso de redução da função renal, pelo risco de acidose lática. A condição foi assinalada na análise.",
        conduta_enfermagem: "Confirmar com o prescritor se a dose está ajustada à função renal atual. Monitorar sinais de desconforto respiratório, sonolência inexplicada ou mal-estar geral. Orientar suspensão temporária em caso de desidratação ou exames com contraste, conforme orientação médica."
      });
    }

    // Regra 6: Dois anti-hipertensivos com risco de hipotensão (se histórico de quedas)
    const antihipertensivos = findMed("losartana", "enalapril", "captopril", "ramipril", "hidroclorotiazida", "furosemida", "anlodipino", "nifedipino", "atenolol", "propranolol", "metoprolol");
    if (antihipertensivos.length >= 2 && conditions.includes("Histórico de quedas")) {
      alerts.push({
        nivel: "moderado",
        titulo: "Múltiplos anti-hipertensivos com histórico de quedas",
        medicamentos_envolvidos: antihipertensivos,
        descricao: "A combinação de dois ou mais agentes anti-hipertensivos, em paciente com histórico de quedas, aumenta o risco de hipotensão postural e novos episódios de queda.",
        conduta_enfermagem: "Orientar o paciente a levantar-se lentamente, sentar-se à beira do leito antes de ficar de pé e manter apoio ao deambular. Verificar pressão arterial em pé e sentado, se possível. Comunicar o prescritor se houver tontura recorrente."
      });
    }

    // Regra 7: Dois ou mais medicamentos de ação no SNC (sem benzo) — cautela em idosos
    const sncTotal = findMed("clonazepam", "diazepam", "lorazepam", "alprazolam", "bromazepam", "tramadol", "codeína", "morfina", "gabapentina", "pregabalina", "zolpidem", "amitriptilina", "nortriptilina", "sertralina", "fluoxetina", "paroxetina");
    if (sncTotal.length >= 2 && !(benzos.length && outrosSNC.length)) {
      alerts.push({
        nivel: "informativo",
        titulo: "Múltiplos medicamentos com ação no sistema nervoso central",
        medicamentos_envolvidos: sncTotal,
        descricao: "O uso de dois ou mais fármacos com ação central em idosos merece monitoramento de sonolência, tontura e alterações de equilíbrio, mesmo sem interação grave identificada.",
        conduta_enfermagem: "Perguntar ativamente sobre sonolência diurna, tontura e episódios de desequilíbrio. Orientar o cuidador a observar mudanças de comportamento ou confusão. Registrar e comunicar ao enfermeiro responsável."
      });
    }

    // Regra 8: Ausência de achados
    if (alerts.length === 0) {
      alerts.push({
        nivel: "informativo",
        titulo: "Nenhum risco evidente identificado nas regras de demonstração",
        medicamentos_envolvidos: [],
        descricao: "A lista fornecida não acionou as regras de simulação desta demonstração. Isso NÃO significa ausência de risco. A avaliação profissional continua indispensável.",
        conduta_enfermagem: "Manter o acompanhamento habitual. Revisar periodicamente a lista de medicamentos com o paciente/cuidador e comunicar qualquer novo sintoma ao prescritor."
      });
    }

    // Ordena: grave > moderado > informativo
    const order = { grave: 0, moderado: 1, informativo: 2 };
    alerts.sort((a, b) => order[a.nivel] - order[b.nivel]);

    return {
      alertas: alerts,
      resumo_geral: `Análise simulada de ${medications.length} medicamento(s). ${alerts.filter(a => a.nivel === "grave").length} alerta(s) grave(s), ${alerts.filter(a => a.nivel === "moderado").length} moderado(s).`
    };
  }

  // ---------- Renderização dos resultados ----------
  function renderResults(analysis, mode) {
    const container = $("#resultsContainer");
    const alertsList = $("#alertsList");
    const badge = $("#modeBadge");
    const meta = $("#resultMeta");

    container.hidden = false;
    badge.className = "badge " + (mode === "api" ? "badge-ai" : "badge-demo");
    badge.textContent = mode === "api" ? "IA CONECTADA" : "MODO DEMONSTRAÇÃO — SIMULAÇÃO";

    meta.textContent = `Paciente: ${analysis.patientName} · ${formatDate(analysis.createdAt)} · ${analysis.medications.length} medicamento(s) · ${analysis.alertas.length} alerta(s)`;

    alertsList.innerHTML = analysis.alertas.map(a => `
      <article class="alert-card level-${escapeHtml(a.nivel)}">
        <div class="alert-head">
          <span class="alert-level">${escapeHtml(a.nivel)}</span>
          <h3 class="alert-title">${escapeHtml(a.titulo)}</h3>
        </div>
        <div class="alert-body">
          <p>${escapeHtml(a.descricao)}</p>
          ${a.medicamentos_envolvidos.length ? `<p><strong>Medicamentos envolvidos:</strong> ${a.medicamentos_envolvidos.map(escapeHtml).join(", ")}</p>` : ""}
          <div class="alert-action">
            <strong>Conduta de enfermagem:</strong> ${escapeHtml(a.conduta_enfermagem)}
          </div>
        </div>
      </article>
    `).join("");

    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Ação: analisar ----------
  async function handleAnalyze() {
    const statusEl = $("#analyzeStatus");
    const btn = $("#btnAnalyze");
    const data = collectFormData();

    if (data.errors.length) {
      showStatus(statusEl, "error", data.errors.join(" "));
      return;
    }

    hideStatus(statusEl);
    btn.disabled = true;
    btn.textContent = "Analisando...";
    showStatus(statusEl, "loading", "Processando análise... Isso pode levar alguns segundos.");

    const apiKey = getApiKey();
    const model = getModel();
    const mode = apiKey ? "api" : "demo";

    let result;
    let usedMode = mode;

    try {
      if (mode === "api") {
        const prompt = buildPrompt(data.patientName, data.medications, data.conditions);
        const raw = await callOpenRouter(prompt, apiKey, model);
        result = parseAIResponse(raw);
        if (!result.resumo_geral) {
          result.resumo_geral = "Análise concluída.";
        }
      } else {
        // Pequeno atraso para simular processamento e permitir que o usuário veja o estado de carregamento
        await new Promise(r => setTimeout(r, 900));
        result = runDemoAnalysis(data.medications, data.conditions);
      }
    } catch (err) {
      console.error("Falha na análise via API, recorrendo à demonstração:", err);
      usedMode = "demo";
      showStatus(statusEl, "error", "Não foi possível conectar à IA real. Exibindo resultado em MODO DEMONSTRAÇÃO (simulação).");
      result = runDemoAnalysis(data.medications, data.conditions);
    }

    const entry = {
      id: uid(),
      createdAt: nowISO(),
      patientName: data.patientName,
      medications: data.medications,
      conditions: data.conditions,
      alertas: result.alertas,
      resumo_geral: result.resumo_geral || "",
      mode: usedMode
    };

    currentAnalysis = entry;

    if (!addAnalysis(entry)) {
      showStatus(statusEl, "error", "Análise gerada, mas não foi possível salvar no armazenamento local. Verifique o espaço disponível.");
    } else {
      hideStatus(statusEl);
    }

    renderResults(entry, usedMode);

    btn.disabled = false;
    btn.textContent = "Analisar com IA";
  }

  // ---------- Renderização do histórico ----------
  function renderHistory() {
    const listEl = $("#historyList");
    const emptyEl = $("#historyEmpty");
    const search = ($("#searchHistory").value || "").toLowerCase().trim();
    const levelFilter = $("#filterLevel").value;

    let items = loadAnalyses();

    if (search) {
      items = items.filter(it => it.patientName.toLowerCase().includes(search));
    }

    if (levelFilter) {
      items = items.filter(it => (it.alertas || []).some(a => a.nivel === levelFilter));
    }

    if (!items.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;

    listEl.innerHTML = items.map(it => {
      const counts = { grave: 0, moderado: 0, informativo: 0 };
      (it.alertas || []).forEach(a => { if (counts[a.nivel] !== undefined) counts[a.nivel]++; });
      const levelBadges = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([lvl, n]) => `<span class="mini-badge mini-${lvl}">${lvl} ${n}</span>`)
        .join("");

      const modeLabel = it.mode === "api" ? "IA real" : "simulação";

      return `
        <article class="history-card" data-id="${escapeHtml(it.id)}">
          <div class="history-main">
            <p class="history-name">${escapeHtml(it.patientName)}</p>
            <p class="history-date">${formatDate(it.createdAt)} · ${it.medications.length} medicamento(s) · ${modeLabel}</p>
            <p class="history-meds">${escapeHtml(it.medications.join(" · "))}</p>
            <div class="history-levels">${levelBadges}</div>
          </div>
          <div class="history-actions">
            <button class="btn btn-ghost btn-sm" data-action="view" data-id="${escapeHtml(it.id)}">Ver</button>
            <button class="btn btn-danger-ghost btn-sm" data-action="delete" data-id="${escapeHtml(it.id)}">Excluir</button>
          </div>
        </article>
      `;
    }).join("");
  }

  // ---------- Ações no histórico ----------
  function handleHistoryClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === "delete") {
      if (confirm("Excluir esta análise do armazenamento local?")) {
        deleteAnalysis(id);
        renderHistory();
      }
    }

    if (action === "view") {
      const item = loadAnalyses().find(a => a.id === id);
      if (item) {
        // Muda para a aba Analisar e renderiza o resultado
        $$(".tab").forEach(t => {
          t.classList.toggle("active", t.dataset.tab === "analyze");
          t.setAttribute("aria-selected", t.dataset.tab === "analyze" ? "true" : "false");
        });
        $("#panel-analyze").hidden = false;
        $("#panel-history").hidden = true;
        $("#panel-settings").hidden = true;
        renderResults(item, item.mode || "demo");
        // Preenche o formulário com os dados do registro visualizado
        $("#patientName").value = item.patientName;
        $("#medications").value = item.medications.join("\n");
        $$('input[name="condition"]').forEach(cb => {
          cb.checked = item.conditions.includes(cb.value);
        });
      }
    }
  }

  // ---------- Configurações ----------
  function syncSettingsUI() {
    $("#apiKey").value = getApiKey();
    $("#modelSelect").value = getModel();
    hideStatus($("#settingsStatus"));
  }

  function handleSaveSettings() {
    const key = $("#apiKey").value.trim();
    const model = $("#modelSelect").value;
    setApiKey(key);
    setModel(model);
    showStatus($("#settingsStatus"), "info",
      key ? "Configuração salva. A próxima análise usará IA real." : "Nenhuma chave informada. A aplicação permanecerá em modo demonstração."
    );
  }

  function handleClearSettings() {
    setApiKey("");
    $("#apiKey").value = "";
    showStatus($("#settingsStatus"), "info", "Chave removida. A aplicação operará em modo demonstração.");
  }

  // ---------- Inicialização ----------
  function init() {
    initTabs();

    // Analisar
    $("#btnAnalyze").addEventListener("click", handleAnalyze);
    $("#btnClearForm").addEventListener("click", () => {
      $("#patientName").value = "";
      $("#medications").value = "";
      $$('input[name="condition"]').forEach(cb => cb.checked = false);
      $("#patientName").classList.remove("error");
      $("#medications").classList.remove("error");
      hideStatus($("#analyzeStatus"));
      $("#resultsContainer").hidden = true;
      currentAnalysis = null;
    });

    // Histórico
    $("#historyList").addEventListener("click", handleHistoryClick);
    $("#searchHistory").addEventListener("input", renderHistory);
    $("#filterLevel").addEventListener("change", renderHistory);
    $("#btnClearAll").addEventListener("click", () => {
      if (confirm("Apagar TODOS os dados de demonstração deste navegador? Esta ação não pode ser desfeita.")) {
        clearAllAnalyses();
        renderHistory();
      }
    });

    // Configurações
    $("#btnSaveSettings").addEventListener("click", handleSaveSettings);
    $("#btnClearSettings").addEventListener("click", handleClearSettings);

    // Render inicial do histórico (caso haja dados)
    renderHistory();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
