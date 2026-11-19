/* ============================================================
   FarmaGuard 2.0 — MVP Hackathon
   SPA Vanilla JS · LocalStorage · OpenRouter opcional
   Funcionalidades: análise, histórico, cronograma, cartão
   de emergência com QR Code e leitura em voz alta.
   ============================================================ */

(function () {
  "use strict";

  const LS_KEY = "farmaguard_analyses_v1";
  const SS_KEY_API = "farmaguard_api_key";
  const SS_KEY_MODEL = "farmaguard_model";

  let currentAnalysis = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function nowISO() { return new Date().toISOString(); }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return iso; }
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

  /* ---------- LocalStorage ---------- */
  function loadAnalyses() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
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
    return saveAnalyses(list.slice(0, 200));
  }

  function deleteAnalysis(id) {
    return saveAnalyses(loadAnalyses().filter(a => a.id !== id));
  }

  function clearAllAnalyses() {
    try {
      localStorage.removeItem(LS_KEY);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- Settings ---------- */
  function getApiKey() { return sessionStorage.getItem(SS_KEY_API) || ""; }
  function setApiKey(k) {
    if (k) sessionStorage.setItem(SS_KEY_API, k);
    else sessionStorage.removeItem(SS_KEY_API);
  }
  function getModel() {
    return sessionStorage.getItem(SS_KEY_MODEL) || "google/gemini-2.0-flash-exp:free";
  }
  function setModel(m) { sessionStorage.setItem(SS_KEY_MODEL, m); }

  /* ---------- Parser de frequência ---------- */
  function parseMedicationFrequency(med) {
    const lower = String(med).toLowerCase();
    const periodSet = new Set();

    const isSOS = /se\s*(?:necess[áa]rio|dor|preciso|precisar|febre)|sos|quando\s*necess[áa]rio|se\s*apresentar/i.test(lower);
    const hasMorning = /manh[ãa]|pela\s*manh|caf[ée]\s*da\s*manh|em\s*jejum/i.test(lower);
    const hasAfternoon = /tarde/i.test(lower);
    const hasNight = /noite|dormir|deitar|antes\s*de\s*dormir/i.test(lower);

    const numWords = { uma: 1, duas: 2, tres: 3, "três": 3, quatro: 4 };
    let timesPerDay = 0;

    const matchNx = lower.match(/(\d+)\s*(?:x|vez(?:es)?)\s*(?:ao|por|no|na)?\s*dia/);
    if (matchNx) timesPerDay = parseInt(matchNx[1], 10);

    if (!timesPerDay) {
      const matchWords = lower.match(/(uma|duas|tr[eê]s|quatro)\s+vez(?:es)?\s+(?:ao|por|no|na)?\s*dia/);
      if (matchWords) timesPerDay = numWords[matchWords[1]] || 0;
    }

    const matchInterval = lower.match(/(\d+)\s*\/\s*(\d+)\s*h/);
    if (matchInterval) {
      const interval = parseInt(matchInterval[1], 10);
      if (interval <= 8) timesPerDay = Math.max(timesPerDay, 3);
      else if (interval <= 12) timesPerDay = Math.max(timesPerDay, 2);
      else timesPerDay = Math.max(timesPerDay, 1);
    }

    if (timesPerDay === 0 && !isSOS && !hasMorning && !hasAfternoon && !hasNight) timesPerDay = 1;

    if (timesPerDay === 1) {
      if (hasNight) periodSet.add("noite");
      else if (hasAfternoon) periodSet.add("tarde");
      else periodSet.add("manha");
    } else if (timesPerDay === 2) {
      periodSet.add("manha");
      periodSet.add("noite");
    } else if (timesPerDay >= 3) {
      periodSet.add("manha");
      periodSet.add("tarde");
      periodSet.add("noite");
    }

    if (hasMorning) periodSet.add("manha");
    if (hasAfternoon) periodSet.add("tarde");
    if (hasNight) periodSet.add("noite");
    if (isSOS) periodSet.add("sos");

    return { periods: Array.from(periodSet), timesPerDay, isSOS };
  }

  /* ---------- QR Code ---------- */
  function buildQRContent(analysis, emergencyContact) {
    const lines = [
      "FARMAGUARD - CARTAO DE EMERGENCIA",
      "Nome: " + (analysis.patientName || "Nao informado"),
      "Medicamentos: " + (analysis.medications || []).join("; ")
    ];
    if (analysis.conditions && analysis.conditions.length) {
      lines.push("Condicoes: " + analysis.conditions.join("; "));
    }
    if (emergencyContact) lines.push("Contato: " + emergencyContact);
    lines.push("Gerado em: " + formatDate(analysis.createdAt));
    lines.push("Aviso: apoio educacional. Nao substitui avaliacao medica.");
    return lines.join("\n");
  }

  function generateQRCode(text, container) {
    if (!container) return;
    try {
      if (typeof qrcode === "undefined") {
        container.innerHTML = '<p class="qr-error">Biblioteca de QR Code não carregada.</p>';
        return;
      }
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (err) {
      console.error("Erro ao gerar QR Code:", err);
      container.innerHTML = '<p class="qr-error">Não foi possível gerar o QR Code.</p>';
    }
  }

  /* ---------- Impressão ---------- */
  function printElement(el) {
    if (!el) return;
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      alert("Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.");
      return;
    }

    let stylesHtml = "";
    for (const sheet of document.styleSheets) {
      try {
        const rules = [];
        for (const rule of sheet.cssRules) rules.push(rule.cssText);
        stylesHtml += "<style>" + rules.join("\n") + "</style>";
      } catch (e) {
        if (sheet.href) stylesHtml += '<link rel="stylesheet" href="' + sheet.href + '">';
      }
    }

    printWindow.document.write(
      '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>FarmaGuard — Impressão</title>' +
      stylesHtml +
      '<style>body{padding:10mm;background:#fff;}@media print{@page{margin:8mm;}} .actions,.results-header button{display:none !important;}</style>' +
      '</head><body>' + el.outerHTML + '</body></html>'
    );
    printWindow.document.close();
    printWindow.onload = function () {
      printWindow.focus();
      printWindow.print();
    };
  }

  /* ---------- Tabs ---------- */
  function initTabs() {
    const tabs = $$(".tab");
    const panels = {
      analyze: $("#panel-analyze"),
      history: $("#panel-history"),
      care: $("#panel-care"),
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
        if (target === "care") renderCarePanel();
        if (target === "settings") syncSettingsUI();
      });
    });
  }

  /* ---------- Status ---------- */
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

  /* ---------- Formulário ---------- */
  function collectFormData() {
    const patientName = $("#patientName").value.trim();
    const medsRaw = $("#medications").value.trim();
    const conditions = $$('input[name="condition"]:checked').map(cb => cb.value);
    const emergencyContactEl = $("#emergencyContact");
    const emergencyContact = emergencyContactEl ? emergencyContactEl.value.trim() : "";

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

    return { patientName, medications: lines, conditions, emergencyContact, errors };
  }

  /* ---------- Prompt ---------- */
  function buildPrompt(patientName, medications, conditions) {
    const medsText = medications.map((m, i) => (i + 1) + ". " + m).join("\n");
    const condText = conditions.length ? conditions.join("; ") : "Nenhuma condição adicional informada.";
    return "Você é um assistente de apoio à decisão em ENFERMAGEM, especializado em segurança medicamentosa de idosos na atenção primária. Você NÃO é médico, NÃO prescreve, NÃO ajusta doses e NÃO emite diagnósticos.\n\n" +
      "Paciente (identificação fictícia): " + patientName + "\n" +
      "Condições relevantes: " + condText + "\n\n" +
      "Lista de medicamentos em uso:\n" + medsText + "\n\n" +
      "TAREFA:\n" +
      "Analise a lista acima e produza alertas de segurança medicamentosa estritamente dentro do escopo de apoio educacional à enfermagem. Identifique:\n" +
      "1. Possíveis interações medicamentosas clinicamente relevantes entre os itens listados.\n" +
      "2. Duplicidades terapêuticas.\n" +
      "3. Medicamentos que exigem cautela especial em idosos.\n" +
      "4. Orientações de enfermagem de baixo risco para cada achado.\n\n" +
      "REGRAS OBRIGATÓRIAS:\n" +
      "- Classifique cada achado como \"grave\", \"moderado\" ou \"informativo\".\n" +
      "- NÃO invente medicamentos que não estejam na lista fornecida.\n" +
      "- NÃO recomende iniciar, suspender ou alterar dose de qualquer medicamento.\n" +
      "- NÃO afirme diagnóstico.\n" +
      "- Para cada alerta, inclua uma \"conduta_enfermagem\" concreta.\n" +
      "- Se não houver achados relevantes, retorne uma lista com um único item informativo.\n\n" +
      "FORMATO DE SAÍDA (JSON estrito, sem markdown, sem texto fora do JSON):\n" +
      "{\n" +
      "  \"alertas\": [\n" +
      "    {\n" +
      "      \"nivel\": \"grave\" | \"moderado\" | \"informativo\",\n" +
      "      \"titulo\": \"string curta\",\n" +
      "      \"medicamentos_envolvidos\": [\"string\", \"...\"],\n" +
      "      \"descricao\": \"string\",\n" +
      "      \"conduta_enfermagem\": \"string\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"resumo_geral\": \"string curta\"\n" +
      "}";
  }

  async function callOpenRouter(prompt, apiKey, model) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
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
      throw new Error("OpenRouter HTTP " + response.status + ": " + text.slice(0, 200));
    }

    const data = await response.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("Resposta vazia do modelo.");
    return content;
  }

  function parseAIResponse(raw) {
    let cleaned = String(raw).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.alertas)) throw new Error("Formato de resposta inesperado.");
    parsed.alertas = parsed.alertas.map(function (a) {
      const lvl = String(a.nivel || "").toLowerCase();
      return {
        nivel: ["grave", "moderado", "informativo"].indexOf(lvl) >= 0 ? lvl : "informativo",
        titulo: String(a.titulo || "Alerta"),
        medicamentos_envolvidos: Array.isArray(a.medicamentos_envolvidos) ? a.medicamentos_envolvidos.map(String) : [],
        descricao: String(a.descricao || ""),
        conduta_enfermagem: String(a.conduta_enfermagem || "Avaliar com o enfermeiro responsável.")
      };
    });
    return parsed;
  }

  /* ---------- Modo demonstração ---------- */
  function runDemoAnalysis(medications, conditions) {
    const medsLower = medications.map(m => m.toLowerCase());
    const alerts = [];
    const findMed = function () {
      const terms = Array.prototype.slice.call(arguments);
      return medsLower.filter(m => terms.some(t => m.indexOf(t) !== -1));
    };
    const has = function (term) { return medsLower.some(m => m.indexOf(term) !== -1); };

    const aines = findMed("ibuprofeno", "diclofenaco", "naproxeno", "nimesulida", "piroxicam", "cetoprofeno", "ácido acetilsalicílico", "aas");
    if (aines.length >= 2) {
      alerts.push({
        nivel: "grave",
        titulo: "Duplicidade de anti-inflamatórios não esteroidais (AINEs)",
        medicamentos_envolvidos: aines,
        descricao: "O uso simultâneo de dois ou mais AINEs aumenta significativamente o risco de lesão renal, sangramento gastrointestinal e retenção hídrica, especialmente em idosos.",
        conduta_enfermagem: "Comunicar o prescritor ou farmacêutico responsável antes da próxima administração. Monitorar sinais de dor epigástrica, fezes escuras, redução do débito urinário e edema."
      });
    } else if (aines.length === 1) {
      const outrosRisco = findMed("losartana", "enalapril", "captopril", "ramipril", "espironolactona", "furosemida", "hidroclorotiazida");
      if (outrosRisco.length >= 1) {
        alerts.push({
          nivel: "moderado",
          titulo: "AINE associado a anti-hipertensivo ou diurético",
          medicamentos_envolvidos: aines.concat(outrosRisco),
          descricao: "AINEs podem reduzir o efeito anti-hipertensivo e, combinados com diuréticos ou IECA/BRA, aumentar o risco de lesão renal aguda e hipercalemia em idosos.",
          conduta_enfermagem: "Monitorar pressão arterial e questionar sobre redução do volume urinário. Orientar hidratação adequada. Comunicar o prescritor se houver tontura ou edema."
        });
      }
    }

    const benzos = findMed("clonazepam", "diazepam", "lorazepam", "alprazolam", "bromazepam");
    const outrosSNC = findMed("tramadol", "codeína", "morfina", "gabapentina", "pregabalina", "zolpidem", "fenobarbital");
    if (benzos.length && outrosSNC.length) {
      alerts.push({
        nivel: "grave",
        titulo: "Associação de depressores do sistema nervoso central",
        medicamentos_envolvidos: benzos.concat(outrosSNC),
        descricao: "A combinação de benzodiazepínicos com outros depressores do SNC aumenta o risco de sedação excessiva, depressão respiratória, confusão mental e quedas em idosos.",
        conduta_enfermagem: "Avaliar nível de consciência, padrão respiratório e risco de queda em cada contato. Comunicar o prescritor sobre sonolência excessiva."
      });
    }

    const varfarina = findMed("varfarina", "warfarina", "marevan");
    if (varfarina.length) {
      const interagentes = findMed("ibuprofeno", "diclofenaco", "naproxeno", "nimesulida", "aas", "ácido acetilsalicílico", "clopidogrel");
      if (interagentes.length) {
        alerts.push({
          nivel: "grave",
          titulo: "Varfarina associada a AINE ou antiagregante plaquetário",
          medicamentos_envolvidos: varfarina.concat(interagentes),
          descricao: "A associação aumenta substancialmente o risco de sangramento grave.",
          conduta_enfermagem: "Verificar sangramento gengival, equimoses, fezes escuras ou hematúria. Comunicar imediatamente o prescritor."
        });
      }
    }

    const iecaBra = findMed("losartana", "enalapril", "captopril", "ramipril", "valsartana", "telmisartana");
    const potassio = findMed("espironolactona", "cloreto de potássio", "kcl");
    if (iecaBra.length && potassio.length) {
      alerts.push({
        nivel: "moderado",
        titulo: "Risco de hipercalemia",
        medicamentos_envolvidos: iecaBra.concat(potassio),
        descricao: "IECA/BRA associados a poupadores de potássio ou suplementos de potássio podem elevar o potássio sérico, com risco de arritmias.",
        conduta_enfermagem: "Verificar exames recentes de potássio e função renal. Questionar sobre fraqueza muscular e palpitações."
      });
    }

    if (has("metformina") && conditions.indexOf("Insuficiência renal") !== -1) {
      alerts.push({
        nivel: "moderado",
        titulo: "Metformina em contexto de insuficiência renal",
        medicamentos_envolvidos: findMed("metformina"),
        descricao: "A metformina exige ajuste ou suspensão em caso de redução da função renal, pelo risco de acidose lática.",
        conduta_enfermagem: "Confirmar com o prescritor se a dose está ajustada à função renal atual."
      });
    }

    const antihipertensivos = findMed("losartana", "enalapril", "captopril", "ramipril", "hidroclorotiazida", "furosemida", "anlodipino", "nifedipino", "atenolol", "propranolol", "metoprolol");
    if (antihipertensivos.length >= 2 && conditions.indexOf("Histórico de quedas") !== -1) {
      alerts.push({
        nivel: "moderado",
        titulo: "Múltiplos anti-hipertensivos com histórico de quedas",
        medicamentos_envolvidos: antihipertensivos,
        descricao: "A combinação de dois ou mais anti-hipertensivos em paciente com histórico de quedas aumenta o risco de hipotensão postural.",
        conduta_enfermagem: "Orientar a levantar-se lentamente. Verificar pressão em pé e sentado. Comunicar o prescritor se houver tontura recorrente."
      });
    }

    const sncTotal = findMed("clonazepam", "diazepam", "lorazepam", "alprazolam", "bromazepam", "tramadol", "codeína", "morfina", "gabapentina", "pregabalina", "zolpidem", "amitriptilina", "nortriptilina", "sertralina", "fluoxetina", "paroxetina");
    if (sncTotal.length >= 2 && !(benzos.length && outrosSNC.length)) {
      alerts.push({
        nivel: "informativo",
        titulo: "Múltiplos medicamentos com ação no sistema nervoso central",
        medicamentos_envolvidos: sncTotal,
        descricao: "O uso de dois ou mais fármacos com ação central em idosos merece monitoramento de sonolência, tontura e alterações de equilíbrio.",
        conduta_enfermagem: "Perguntar ativamente sobre sonolência diurna, tontura e desequilíbrio."
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        nivel: "informativo",
        titulo: "Nenhum risco evidente identificado nas regras de demonstração",
        medicamentos_envolvidos: [],
    
