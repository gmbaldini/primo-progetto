
import { useState, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// CLINICAL ENGINE — generates protocol from patient data
// ═══════════════════════════════════════════════════════════════

function generateProtocol(data) {
  const { scenario, eg, allergie, pesoKg, creatinina,
    temperatura, fcMaterna, fcFetale, wbc, crp,
    gbsStatus, gbsData, membraneStatus, oreRottura, tamponeCVResult, tamponeCV_ABG, urocoltura, uroABG,
    esameUrineNitrati, esameUrineLeucociti, sintomiUrinari, sintomiVaginali, precedenteNeonatoGBS,
    precedentePTB, g6pd, tempPersistente, tamponeDisponibile, sintomiVaginaliDettaglio,
    batteriuriaGBS, tcElettivoMI, ivuRicorrenti, cerchiaggio, gbsPrecedenteGrav,
    saccoInVagina, dilatazioneCervicale, idronefrosiGrado, doloreColica,
    emocoltura, emocolturaGerme } = data;

  const trimestre = eg < 14 ? 1 : eg < 28 ? 2 : 3;
  const aTermine = eg >= 37;
  const pretermine = eg < 37;
  const periviabile = eg < 24;
  const latePreterm = eg >= 34 && eg < 37;

  // ═══ ALLERGIA: derive from allergie object ═══
  const a = allergie || {};
  const allergiaBetalatt = !!a.penicilline;
  const allergiaAlto = a.penicilline === "alto";
  const allergiaBasso = a.penicilline === "basso";
  const allergiaCefalo = !!a.cefalosporine;
  const allergiaMacrolidi = !!a.macrolidi;
  const allergiaClinda = !!a.clindamicina;
  const allergiaMetro = !!a.metronidazolo;
  const allergiaSulfa = !!a.sulfonamidi;
  const allergiaAmino = !!a.aminoglicosidi;

  const febbre = temperatura >= 38;
  const febbreAlta = temperatura >= 39;
  const febbreSospetta = temperatura >= 38 && temperatura < 39 && tempPersistente;
  const tachicardiaFetale = fcFetale > 160;
  const leucocitosi = wbc > 15000;

  const results = { diagnosi: [], protocollo: [], alerts: [], monitoraggio: [], fonti: [] };

  // ═══ DERIVED: weight-based dosing ═══
  const peso = pesoKg || 70; // default if not provided
  const vancoDosingStr = pesoKg ? `${Math.min(2000, Math.round(pesoKg * 20 / 100) * 100)}mg IV ogni 8h fino al parto (= 20mg/kg × ${pesoKg}kg, max 2g/dose, infusione ≥1h)` : "20mg/kg IV ogni 8h fino al parto (max 2g/dose, infusione ≥1h) — INSERIRE PESO per dosaggio esatto";
  const cefazolinaTCDose = (pesoKg && pesoKg >= 120) ? "3g IV" : "2g IV";
  const ceftriaxoneNGDose = (pesoKg && pesoKg >= 150) ? "1g IM singola" : "500mg IM singola";
  const irc = creatinina && creatinina > 1.0; // in gravidanza, >0.8 è già sospetta
  const ircSevera = creatinina && creatinina > 1.5;

  // ═══ TC ELETTIVO — no IAP ═══
  if (tcElettivoMI && (scenario === "travaglio" || scenario === "promTermine")) {
    results.diagnosi.push({ label: "TC elettivo con membrane integre", severity: "info", detail: "IAP GBS NON indicata — anche se GBS positiva (ACOG CO #797)" });
    results.alerts.push({ type: "info", text: "Nessun antibiotico per GBS. La profilassi chirurgica TC è un protocollo separato (Cefazolina weight-based ± Azitromicina)" });
    if (pesoKg) {
      results.alerts.push({ type: "info", text: `Profilassi TC: Cefazolina ${cefazolinaTCDose} entro 60min dall'incisione${pesoKg >= 120 ? " (dose aumentata per peso ≥120kg)" : ""}` });
    }
    results.fonti.push("ACOG CO #797 2020", "Tita NEJM 2016 C/SOAP");
    return results;
  }

  // ═══ BATTERIURIA GBS — auto IAP ═══
  if (batteriuriaGBS && (scenario === "travaglio" || scenario === "promTermine")) {
    results.alerts.push({ type: "danger", text: "Batteriuria GBS in questa gravidanza (qualsiasi carica) → IAP OBBLIGATORIA al parto (ACOG CO #797). Trattare come GBS positiva" });
  }

  // ═══ EMOCOLTURA POSITIVA — cross-scenario (SEPSI fino a prova contraria) ═══
  if (emocoltura === "positiva" && emocolturaGerme) {
    results.diagnosi.push({ label: `EMOCOLTURA POSITIVA: ${emocolturaGerme} — SEPSI fino a prova contraria`, severity: "danger",
      detail: "Emocoltura positiva = batteriemia documentata. Consulenza infettivologica URGENTE. Terapia mirata all'antibiogramma dell'emocoltura" });
    results.alerts.push({ type: "danger", text: `SEPSI da ${emocolturaGerme}: richiedere antibiogramma dell'emocoltura se non disponibile. Monitoraggio emodinamico materno. Terapia empirica ad ampio spettro fino ad antibiogramma: Tazocin® 4,5g IV/6h (se non allergia β-latt) O Meropenem 1g IV/8h` });
    results.alerts.push({ type: "danger", text: "Consulenza infettivologica URGENTE — la gestione della sepsi in gravidanza richiede collaborazione multidisciplinare" });
    results.monitoraggio.push("Emocolture di controllo dopo 48-72h di terapia", "Lattati, procalcitonina, emocromo seriati", "Monitoraggio emodinamico materno (PA, FC, diuresi)");
  } else if (emocoltura === "positiva") {
    results.alerts.push({ type: "danger", text: "EMOCOLTURA POSITIVA — inserire il germe isolato per ricevere raccomandazioni terapeutiche mirate" });
  }

  // ═══ GBS NELLE URINE — cross-scenario ═══
  if (urocoltura && urocoltura.toLowerCase().includes("gbs") && (scenario === "ivu" || scenario === "colicaRenale")) {
    results.alerts.push({ type: "danger", text: "GBS nelle urine (QUALSIASI carica) → IAP OBBLIGATORIA AL PARTO (ACOG CO #797). GBS in urina = marker di colonizzazione anogenitale importante. NON serve tampone VR a 36-37s" });
    results.alerts.push({ type: "warning", text: "Se ≥10⁵ UFC/mL o sintomatica: TRATTARE la IVU (amoxicillina o cefalexina × 7gg). Se <10⁵ asintomatica: NON trattare antepartum, ma IAP al parto COMUNQUE" });
    results.alerts.push({ type: "info", text: "Anche se trattata e urinocoltura di controllo negativa → IAP al parto COMUNQUE. La ricolonizzazione dopo antibiotici è tipica (ACOG CO #797). GBS batteriuria = indicazione PERMANENTE per IAP in questa gravidanza" });
  }

  // ═══ GBS POSITIVO AL TAMPONE VR — NON trattare antepartum ═══
  if (gbsStatus === "positivo" && scenario !== "travaglio" && scenario !== "pprom" && scenario !== "promTermine") {
    results.alerts.push({ type: "danger", text: "GBS al tampone VR: NON trattare antepartum per eradicare la colonizzazione (ACOG CO #797: 'antimicrobial agents should not be used before the intrapartum period to eradicate GBS colonization'). Il trattamento orale è inefficace (ricolonizzazione tipica) e promuove resistenza. IAP IV al momento del travaglio/parto" });
  }

  // ═══ GBS POSITIVO — sensibilità clindamicina ═══
  if (gbsStatus === "positivo" && (!tamponeCV_ABG || !tamponeCV_ABG.clindamicina || tamponeCV_ABG.clindamicina === "non_testata")) {
    results.alerts.push({ type: "warning", text: "GBS positivo: sensibilità alla CLINDAMICINA non nota. Richiedere ATTIVAMENTE l'antibiogramma al laboratorio — molti lab non testano clindamicina di routine per GBS, serve richiesta specifica. Se non disponibile al parto e paziente allergica → ACOG CO #797 raccomanda vancomicina (per precauzione, NON perché il ceppo è resistente)" });
  }

  // ═══ CORIOAMNIONITE / INFEZIONE CHECK (priorità massima — cross-scenario) ═══
  if (scenario === "travaglio" || scenario === "pprom" || scenario === "promTermine" || scenario === "incompCervicale" || scenario === "colicaRenale") {
    const criteriCorio = [];
    if (febbreAlta) criteriCorio.push("T ≥39°C singola");
    if (febbreSospetta) criteriCorio.push("T 38-38,9°C persistente ≥30min");
    const criteriAccessori = [];
    if (leucocitosi) criteriAccessori.push("leucocitosi >15.000/mm³");
    if (tachicardiaFetale) criteriAccessori.push("tachicardia fetale >160 bpm");
    if (sintomiVaginali === "scolo_purulento") criteriAccessori.push("scolo cervicale purulento");

    // ═══ A: CRITERI FORMALI ACOG CPU 2024 SODDISFATTI ═══
    if ((febbreAlta || febbreSospetta) && criteriAccessori.length >= 1) {
      results.diagnosi.push({ label: "SOSPETTA CORIOAMNIONITE / IUI", severity: "danger",
        detail: `Criteri ACOG CPU luglio 2024: ${criteriCorio.join(" + ")} + ${criteriAccessori.join(", ")}` });
      results.protocollo.push({ label: "Trattamento IMMEDIATO — Non ritardare il parto", items: [
        { drug: "Ampicillina (Amplital®)", dose: "2g IV ogni 6 ore", notes: "Carico immediato. Copre anche GBS" },
        { drug: "Gentamicina (Gentalyn®)", dose: "5mg/kg IV ogni 24 ore", notes: "Dose unica giornaliera" },
      ]});
      results.alerts.push({ type: "danger", text: "Se TC: AGGIUNGERE Clindamicina (Dalacin®) 900mg IV ogni 8h dopo clampaggio" });
      results.alerts.push({ type: "danger", text: "Post parto vaginale: 1 dose poi STOP. Post TC: fino apiressia ≥24h" });
      results.alerts.push({ type: "danger", text: "NON ritardare il parto per completare l'antibiotico. L'ampicillina per IUI copre anche il GBS — NON aggiungere Penicillina G separata" });
      if (wbc <= 15000 && !febbre) {
        results.alerts.push({ type: "warning", text: "NOTA: 73% delle sepsi da IUI è apirettica (Higgins 2016). Valutare clinicamente anche senza febbre" });
      }
      results.fonti.push("ACOG CPU luglio 2024", "ACOG CO #712 2017", "Cochrane CD007838");
      // Per scenari ostetrici: la corioamnionite sovrascrive tutto → return
      // Per scenari NON ostetrici (colica, IC): aggiungere alert ma proseguire con motore scenario-specifico
      if (scenario === "travaglio" || scenario === "pprom" || scenario === "promTermine") {
        return results;
      }
      // Per IC e colicaRenale: febbre + leucocitosi possono essere da infezione UROLOGICA, non necessariamente IUI
      if (scenario === "incompCervicale") {
        results.alerts.push({ type: "danger", text: "Con segni infettivi + IC: ESCLUDERE IUI → se confermata: rimozione cerchiaggio + espletamento. Se infezione NON intra-uterina (es. pielo): trattare la causa + monitoraggio per IUI" });
      }
      if (scenario === "colicaRenale") {
        results.alerts.push({ type: "warning", text: "⚠ Febbre + leucocitosi in contesto di patologia urologica: più probabile pielonefrite/pionefrosi che corioamnionite. Tuttavia ESCLUDERE IUI concomitante (CTG, speculum, PCR seriata). Proseguire con gestione urologica + antibiotici mirati" });
      }
    }

    // ═══ B: CRITERI FORMALI NON SODDISFATTI MA QUADRO INFETTIVO SOSPETTO ═══
    // T 37.5-37.9 + leucocitosi marcata, OPPURE leucocitosi + CRP elevata senza febbre
    const subFebbre = temperatura >= 37.5 && temperatura < 38;
    const leucocitosiMarcata = wbc > 20000;
    const crpElevata = crp > 10;
    const sospettoInfettivo = (subFebbre && leucocitosi) || (subFebbre && crpElevata) || (leucocitosiMarcata && crpElevata) || (leucocitosiMarcata && subFebbre);

    if (sospettoInfettivo) {
      const markers = [];
      if (subFebbre) markers.push(`T ${temperatura}°C (sub-febbrile)`);
      if (leucocitosi) markers.push(`WBC ${wbc ? wbc.toLocaleString() : '>15.000'}/mm³`);
      if (crpElevata) markers.push(`PCR ${crp} mg/L`);
      if (tachicardiaFetale) markers.push("tachicardia fetale");

      results.diagnosi.push({ label: "⚠ SOSPETTO INFETTIVO — non soddisfa formalmente i criteri ACOG CPU 2024 ma quadro clinico altamente suggestivo", severity: "danger",
        detail: `Marcatori: ${markers.join(", ")}. I criteri ACOG CPU 2024 servono per la CLASSIFICAZIONE, non per la decisione terapeutica. Con questo quadro: TRATTARE come sospetta IUI` });

      results.protocollo.push({ label: "Iniziare Amplital® — rivalutare a 30 min per escalation", items: [
        { drug: "Ampicillina (Amplital®)", dose: "2g IV ogni 6 ore fino al parto", notes: "Copre GBS + principali patogeni IUI. NON aggiungere IAP separata" },
        { drug: "⏱ Rivalutare a 30 min", dose: "Ricontrollare temperatura + CTG", notes: "Se T ≥38°C confermata → AGGIUNGERE Gentalyn® 5mg/kg IV ogni 24h (regime IUI completo ACOG)" },
      ]});
      results.alerts.push({ type: "danger", text: `ATTENZIONE: T ${temperatura}°C è appena sotto la soglia ACOG (38°C), ma WBC ${wbc ? wbc.toLocaleString() : 'elevati'} e PCR ${crp || 'elevata'} indicano un processo infettivo in corso. Ricontrollare T a 30 min — se ≥38°C aggiungere Gentalyn® (regime IUI completo)` });
      results.alerts.push({ type: "info", text: "L'ampicillina 2g IV/6h copre GBS — non serve IAP separata. Se la temperatura NON sale e il quadro migliora, l'ampicillina da sola è sufficiente" });
      results.alerts.push({ type: "warning", text: "Se TC: aggiungere Dalacin® 900mg IV al clampaggio. Post parto vaginale: 1 dose poi STOP. Post TC: fino apiressia ≥24h" });
      results.alerts.push({ type: "warning", text: "Richiedere EMOCOLTURE (2 set da siti diversi) se non già eseguite — prima della dose antibiotica se possibile ma senza ritardare il trattamento" });
      if (!gbsStatus || gbsStatus === "ignoto") {
        results.alerts.push({ type: "info", text: "GBS ignoto: l'ampicillina che stai dando copre il GBS. Prelevare tampone VR per gestione neonatale" });
      }
      results.fonti.push("ACOG CPU luglio 2024", "ACOG CO #712 2017", "Higgins ObGyn 2016");
      if (scenario === "travaglio" || scenario === "pprom" || scenario === "promTermine") {
        return results;
      }
    }

    // ═══ C: FEBBRE ISOLATA O LEUCOCITOSI ISOLATA — alert senza override ═══
    if (febbre && criteriAccessori.length === 0) {
      results.alerts.push({ type: "warning", text: `Febbre materna isolata (${temperatura}°C) — ricontrollare a 30 min (ACOG CPU 2024). Se persistente + ≥1 criterio accessorio → sospetta IUI. Intanto: IAP GBS se indicata + monitoraggio stretto` });
    }
    if (leucocitosi && !febbre && !subFebbre) {
      results.alerts.push({ type: "warning", text: `Leucocitosi isolata (WBC ${wbc ? wbc.toLocaleString() : '>15.000'}) senza febbre — può essere fisiologica in travaglio (fino a 20.000). Se >20.000 o in aumento: sospettare infezione subclinica` });
    }
  }

  // ═══ IVU ═══
  if (scenario === "ivu") {
    const haUrocoltura = urocoltura && urocoltura !== "" && urocoltura !== "negativa";
    const haAntibiogramma = uroABG && Object.keys(uroABG).length > 0;
    const sintomi = sintomiUrinari === "si";
    const isPielo = temperatura >= 38 || (sintomiUrinari === "pielo");

    if (isPielo) {
      results.diagnosi.push({ label: "PIELONEFRITE", severity: "danger", detail: "Ospedalizzazione obbligatoria (ACOG CC No.4 2023)" });
      if (!allergiaBetalatt) {
        results.protocollo.push({ label: "Fase IV — fino apiressia 48h", items: [
          { drug: "Ceftriaxone (Rocefin®)", dose: "1-2g IV ogni 24 ore", notes: "1ª scelta ACOG" },
        ]});
        results.protocollo.push({ label: "Step-down orale — totale 14 giorni", items: [
          { drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6 ore", notes: "Guidata da antibiogramma se disponibile" },
        ]});
      } else if (allergiaBasso) {
        results.protocollo.push({ label: "Fase IV (allergia basso rischio)", items: [
          { drug: "Ceftriaxone (Rocefin®)", dose: "1-2g IV ogni 24 ore", notes: "Cross-reattività cefalosporine ~1-2%" },
        ]});
      } else {
        results.protocollo.push({ label: "Fase IV (allergia alto rischio)", items: [
          { drug: "Aztreonam (Azactam®)", dose: "1g IV ogni 8-12 ore", notes: "ACOG CC No.4 2023" },
        ]});
      }
      if (haAntibiogramma) {
        if (uroABG.esbl) {
          results.protocollo.unshift({ label: "⚠ ESBL POSITIVO — Regime mirato", items: [
            { drug: "Ertapenem (Invanz®)", dose: "1g IV ogni 24 ore", notes: "IDSA cUTI GL 2025. Totale 14 giorni" },
          ]});
        }
        results.alerts.push({ type: "info", text: `Antibiogramma disponibile: adattare step-down orale al profilo di sensibilità del germe isolato (${urocoltura})` });
      }
      const soppressivaItems = [];
      if (!allergiaBetalatt && !g6pd) {
        soppressivaItems.push({ drug: "Nitrofurantoina (Neofuradantin®) o Cefalexina (Keforal®)", dose: "100mg o 250-500mg per os alla sera per il RESTO della gravidanza", notes: "Stop nitrofurantoina a 36-38s. Se G6PD: solo cefalexina" });
      } else if (allergiaAlto || allergiaBasso) {
        // β-latt allergia → no cefalexina → solo nitrofurantoina (se non G6PD)
        if (!g6pd) {
          soppressivaItems.push({ drug: "Nitrofurantoina (Neofuradantin®)", dose: "100mg per os alla sera per il RESTO della gravidanza", notes: "Allergia β-latt → cefalexina CI. Stop nitrofurantoina a 36-38s" });
        } else {
          soppressivaItems.push({ drug: "Consulenza infettivologica per soppressiva", dose: "G6PD+ e allergia β-latt → nessun soppressivo standard disponibile", notes: "Nitrofurantoina CI (G6PD), cefalexina CI (allergia β-latt). Monitoraggio urinocoltura seriato in alternativa" });
        }
      } else if (g6pd) {
        soppressivaItems.push({ drug: "Cefalexina (Keforal®)", dose: "250-500mg per os alla sera per il RESTO della gravidanza", notes: "G6PD+ → nitrofurantoina CI. Solo cefalexina" });
      }
      results.protocollo.push({ label: "Terapia soppressiva post-pielonefrite", items: soppressivaItems });
      results.alerts.push({ type: "danger", text: "Mancata risposta 48-72h → eco renale → escludere ostruzione → stent JJ / nefrostomia" });
      results.alerts.push({ type: "warning", text: "Fosfomicina e Nitrofurantoina: MAI per pielonefrite (non raggiungono il parenchima renale)" });
      results.monitoraggio.push("Emocromo, PCR, funzione renale ogni 24h", "Urinocoltura di controllo 1-2 settimane dopo fine terapia", "Eco renale se non risposta 48-72h");
      results.fonti.push("ACOG CC No.4 2023", "IDSA cUTI GL 2025", "EAU Urological Infections GL 2025");
    } else {
      // BA o cistite
      const isBA = !sintomi;
      results.diagnosi.push({ label: isBA ? "BATTERIURIA ASINTOMATICA" : "CISTITE ACUTA", severity: "warning",
        detail: isBA ? "Trattamento riduce rischio pielonefrite (OR 0,18 Cochrane)" : "Trattamento 7 giorni (ACOG CC No.4 2023)" });

      if (haAntibiogramma && haUrocoltura) {
        results.alerts.push({ type: "info", text: `Germe isolato: ${urocoltura}. Terapia MIRATA all'antibiogramma — farmaci sensibili ordinati per preferenza in gravidanza:` });
        const sensibili = [];
        // 1ª linea — sicuri tutti i trimestri
        if (uroABG.fosfomicina === "S") sensibili.push({ drug: "Fosfomicina (Monuril®)", dose: "3g per os singola", duration: "dose unica", notes: "1ª scelta se sensibile. Solo IVU basse (ACOG CC No.4 2023)" });
        if (uroABG.cefalexina === "S") sensibili.push({ drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6h", duration: "7 giorni", notes: "Sicura tutti i trimestri (ACOG CC No.4 2023)" });
        if (uroABG.amoxicillina === "S") sensibili.push({ drug: "Amoxicillina (Zimox®)", dose: "500mg per os ogni 8h", duration: "7 giorni", notes: "Solo se sensibile all'ABG — MAI empirica (R 20-40% IT)" });
        if (uroABG.amoxclav === "S") {
          const amoxclavNote = eg < 34
            ? "⚠ PRETERMINE <34s: sebbene la CI formale sia SOLO nella pPROM (ORACLE I), in contesto pretermine con rischio di parto imminente considerare alternative (cefalexina, nitrofurantoina) per precauzione — il meccanismo NEC è legato alla disbiosi neonatale, non solo alle membrane rotte. Se Augmentin® è l'UNICO sensibile: usare con consapevolezza del rischio teorico"
            : eg < 37
            ? "Lecito ma NON 1ª scelta in pretermine. Se alternative sensibili disponibili, preferire cefalexina o nitrofurantoina. CI formale solo nella pPROM (ORACLE I)"
            : "OK per IVU a termine. CI solo nella pPROM (ORACLE I). ACOG CC No.4 2023 lo include tra le opzioni";
          sensibili.push({ drug: "Amox-clav (Augmentin®)", dose: "875/125mg per os ogni 12h", duration: "7 giorni", notes: amoxclavNote });
        }
        // 2ª linea — restrizioni trimestrali
        if (uroABG.nitrofurantoina === "S") {
          if (eg < 36) {
            sensibili.push({ drug: "Nitrofurantoina (Neofuradantin®)", dose: "100mg per os ogni 12h (rilascio modificato)", duration: "7 giorni", notes: `Sicura in I-II-III trim. STOP a 36-38s per rischio anemia emolitica neonatale. ${g6pd ? "⚠ CI in G6PD!" : ""} (ACOG CC No.4 2023; NICE NG109)` });
          } else {
            sensibili.push({ drug: "Nitrofurantoina — ⚠ EG ≥36s", dose: "EVITARE", duration: "—", notes: "Rischio emolisi neonatale a termine. Switch a cefalexina (ACOG CC No.4)" });
          }
        }
        if (uroABG.tmpsmx === "S") {
          if (trimestre === 2) {
            sensibili.push({ drug: "TMP-SMX (Bactrim®)", dose: "160/800mg per os ogni 12h", duration: "7 giorni", notes: "SOLO II trimestre. Acido folico 4mg/die obbligatorio. Antagonista folati → CI nel I trim (NTD). CI a termine (kernicterus). ACOG CC No.4 2023" });
          } else if (trimestre === 1) {
            sensibili.push({ drug: "TMP-SMX (Bactrim®) — ⚠ I TRIMESTRE", dose: "CONTROINDICATO", duration: "—", notes: "Antagonista dei folati → rischio difetti del tubo neurale. Usare alternativa (ACOG CC No.4 2023)" });
          } else {
            // III trimestre
            if (eg < 36) {
              sensibili.push({ drug: "TMP-SMX (Bactrim®)", dose: "160/800mg per os ogni 12h", duration: "7 giorni", notes: "Accettabile fino a 36s con acido folico 4mg/die. CI a ≥36s per rischio kernicterus (ACOG CC No.4 2023)" });
            } else {
              sensibili.push({ drug: "TMP-SMX (Bactrim®) — ⚠ EG ≥36s", dose: "CONTROINDICATO", duration: "—", notes: "Rischio kernicterus neonatale a termine. Usare alternativa" });
            }
          }
        }
        // IV — solo per pielonefrite o se NO opzioni orali
        const sensibiliOrali = sensibili.filter(s => !s.drug.includes("IV") && s.dose !== "CONTROINDICATO" && s.dose !== "EVITARE");
        if (uroABG.ceftriaxone === "S") sensibili.push({ drug: "Ceftriaxone (Rocefin®)", dose: "1-2g IV ogni 24h", duration: "fino apiressia 48h → step-down orale", notes: "Solo per pielonefrite o IVU complicata (ACOG CC No.4 2023). NON per cistite semplice di routine" });
        if (uroABG.gentamicina === "S") sensibili.push({ drug: "Gentamicina (Gentalyn®)", dose: "5mg/kg IV ogni 24h", duration: "fino apiressia 48h (con TDM)", notes: "Solo per pielonefrite o IVU complicata. NON per cistite di routine" });

        if (sensibili.length > 0) {
          // Per cistite: se NESSUN farmaco orale sensibile, avvertire
          if (sensibiliOrali.length === 0 && !isPielo) {
            results.alerts.push({ type: "danger", text: `⚠ NESSUN antibiotico ORALE sensibile per ${urocoltura}. Opzioni: (1) Ricovero per terapia IV (ceftriaxone/gentamicina se sensibili). (2) Consulenza infettivologica per alternative (ertapenem 1g IV/die se ESBL+). (3) Se ESBL+: nitrofurantoina può mantenere sensibilità in vitro anche con ESBL — verificare ABG specifico (IDSA cUTI GL 2025)` });
          }
          results.protocollo.push({ label: `Terapia mirata per ${urocoltura} (antibiogramma disponibile)`, items: sensibili.map(s => ({
            drug: s.drug, dose: s.dose + (s.duration !== "—" ? ` × ${s.duration}` : ""), notes: s.notes
          })) });
        } else {
          results.alerts.push({ type: "danger", text: `Nessun antibiotico testato risulta sensibile per ${urocoltura}. Consulenza infettivologica. Considerare: ertapenem (Invanz®) 1g IV/die se ESBL+, aztreonam (Azactam®) 1g IV q8-12h se allergia β-latt` });
        }
      } else {
        // Empirica
        results.protocollo.push({ label: "Terapia empirica (in attesa antibiogramma)", items: [
          { drug: "Fosfomicina (Monuril®)", dose: "3g per os dose singola", notes: "1ª scelta empirica IT (AOGOI). Resistenza <5% in IT" },
          { drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6 ore × 7 giorni", notes: "1ª scelta ACOG. Sicura tutti i trimestri" },
        ]});
        if (trimestre === 2) {
          results.protocollo[results.protocollo.length-1].items.push(
            { drug: "Nitrofurantoina (Neofuradantin®)", dose: "100mg per os ogni 12h × 7 giorni", notes: "Solo II trim. NO G6PD. NO ≥38 settimane" }
          );
        }
        results.alerts.push({ type: "warning", text: "Amoxicillina da SOLA: MAI empirica (R E. coli 20-40% in IT). Solo con antibiogramma (ACOG CC No.4)" });
      }
      results.monitoraggio.push("Urinocoltura di controllo 1-2 settimane dopo fine terapia");
      results.alerts.push({ type: "info", text: "Durata trattamento: 7 giorni (ACOG CC No.4 2023 indica un range di 5-7gg — in gravidanza si preferisce il limite superiore per la farmacocinetica alterata). Eccezione: fosfomicina dose singola (Cochrane Widmer 2015: dati insufficienti per raccomandare una durata specifica)" });
      if (isBA) results.alerts.push({ type: "info", text: "ISS/SNLG dic 2023: screening BA ABOLITO in IT per gravidanza fisiologica (divergenza da ACOG)" });
      // ═══ IRC check ═══
      if (irc) {
        results.alerts.push({ type: "danger", text: `Creatinina ${creatinina} mg/dL (elevata in gravidanza). Nitrofurantoina CONTROINDICATA se eGFR <30. Aggiustare dosaggio gentamicina. Augmentin® 875/125 non usare se eGFR <30` });
      }
      // ═══ G6PD check ═══
      if (g6pd) {
        results.alerts.push({ type: "danger", text: "Deficit G6PD: Nitrofurantoina CONTROINDICATA (emolisi). Anche TMP-SMX con cautela" });
      }
      // ═══ IVU ricorrenti ═══
      if (ivuRicorrenti) {
        results.protocollo.push({ label: "Terapia soppressiva per IVU ricorrenti (≥2 episodi)", items: [
          { drug: "Nitrofurantoina (Neofuradantin®) o Cefalexina (Keforal®)", dose: "100mg o 250-500mg per os alla sera per il RESTO della gravidanza", notes: "Stop nitrofurantoina a 36-38s. Se G6PD: solo cefalexina" + (g6pd ? " — ATTENZIONE G6PD: usare SOLO cefalexina" : "") },
        ]});
        results.alerts.push({ type: "warning", text: "IVU ricorrenti (≥2): soppressiva indicata anche senza pielonefrite (ACOG CC No.4 2023)" });
      }
      // ═══ Batteriuria GBS ═══
      if (batteriuriaGBS) {
        results.alerts.push({ type: "danger", text: "Batteriuria GBS confermata → IAP OBBLIGATORIA al parto, indipendentemente dal tampone VR (ACOG CO #797)" });
      }
      results.fonti.push("ACOG CC No.4 2023", "NICE NG109 2018", "AOGOI 2020");
    }
    return results;
  }

  // ═══ CERVICOVAGINALE ═══
  if (scenario === "cervicovaginale") {
    const pathogen = (tamponeDisponibile === "si") ? tamponeCVResult : null;
    const treatments = {
      "candida": { diagnosi: "Candidosi Vulvovaginale", items: [
        { drug: "Clotrimazolo (Canesten®) crema 1%", dose: "5g intravag × 7 giorni", notes: "Solo TOPICI in gravidanza" }],
        alerts: [{ type: "danger", text: "Fluconazolo orale CONTROINDICATO a qualsiasi dose (NEJM 2013 OR 3,16 per ToF; CMAJ 2019 aOR 2,23 per aborto)" }] },
      "bv": { diagnosi: "Vaginosi Batterica", items: [
        { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2v/die × 7 giorni", notes: "Sicuro TUTTI i trimestri (Burtin 1995 OR 0,93)" }],
        alerts: [] },
      "chlamydia": { diagnosi: "Chlamydia trachomatis", items: [
        { drug: "Azitromicina (Zitromax®)", dose: "1g per os dose singola", notes: "Test of cure NAAT a 4 settimane + retest 3 mesi" }],
        alerts: [{ type: "warning", text: "Trattare partner (ultimi 60gg). Doxiciclina CI in gravidanza" }] },
      "gonorrea": { diagnosi: "Neisseria gonorrhoeae", items: [
        { drug: "Ceftriaxone (Rocefin®)", dose: `${ceftriaxoneNGDose}${pesoKg && pesoKg >= 150 ? " (dose ↑ per peso ≥150kg)" : ""}`, notes: "Se CT non esclusa: + Zitromax® 1g" }],
        alerts: allergiaAlto ? [{ type: "danger", text: "Allergia alto rischio β-latt: consulenza infettivologica per desensibilizzazione (CDC)" }] : [] },
      "trichomonas": { diagnosi: "Trichomonas vaginalis", items:
        sintomiVaginali === "si" ? [{ drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2v/die × 7 giorni", notes: "Solo SINTOMATICHE" }] :
        [{ drug: "NESSUN TRATTAMENTO", dose: "—", notes: "Asintomatiche: NON trattare (Klebanoff NEJM 2001: PTB 19% vs 10,7%)" }],
        alerts: sintomiVaginali !== "si" ? [{ type: "danger", text: "Trichomonas asintomatica: trattamento AUMENTA rischio PTB. NON trattare" }] : [] },
      "m_hominis": { diagnosi: "Mycoplasma hominis", items: [
        { drug: "Clindamicina (Dalacin®)", dose: "300mg per os 3v/die × 7 giorni", notes: "M. hominis è RESISTENTE a azitro/eritro (intrinseca)" }],
        alerts: [{ type: "danger", text: "NON prescrivere macrolidi (azitro/eritro): resistenza intrinseca" }] },
      "ureaplasma": { diagnosi: "Ureaplasma spp.", items: [
        { drug: "Azitromicina (Zitromax®)", dose: "1g per os singola o 500mg g1 + 250mg gg2-5", notes: "Solo se indicato clinicamente" }],
        alerts: [{ type: "warning", text: "Screening e trattamento di routine NON raccomandati (Cochrane CD003767; CDC 2021)" }] },
    };

    if (tamponeCV_ABG && Object.keys(tamponeCV_ABG).length > 0) {
      results.alerts.push({ type: "info", text: "Antibiogramma disponibile: verificare sensibilità del ceppo isolato e adattare se necessario" });
    }

    const tx = treatments[pathogen];
    if (tx) {
      results.diagnosi.push({ label: tx.diagnosi, severity: "warning", detail: "Terapia per patogeno identificato" });
      results.protocollo.push({ label: `Trattamento ${tx.diagnosi}`, items: tx.items });
      // ═══ CO-INFEZIONE: se BV + sintomi suggestivi di candidosi (prurito, mista) → aggiungere topico ═══
      if (pathogen === "bv" && (sintomiVaginaliDettaglio === "mista_aspecifica" || sintomiVaginaliDettaglio === "prurito_eritema")) {
        results.protocollo.push({ label: "Trattamento co-infezione Candida (sintomi misti)", items: [
          { drug: "Clotrimazolo (Canesten®) crema 1%", dose: "5g intravag × 7 giorni", notes: "BV + prurito/eritema vulvare = sospetta co-infezione BV+Candida. CDC 2021: trattare entrambe" },
        ]});
        results.alerts.push({ type: "info", text: "Alternativa per BV+Candida: Meclon® (metronidazolo 500mg + clotrimazolo 100mg) 1 ovulo intravag/die × 6-10gg — copre entrambe in singola formulazione (pratica clinica IT, non nelle LG internazionali)" });
      }
      // Se BV senza sintomi misti: nota comunque sulla possibilità
      if (pathogen === "bv" && !sintomiVaginaliDettaglio) {
        results.alerts.push({ type: "info", text: "Se co-infezione candidosica sospetta (prurito vulvare associato): aggiungere clotrimazolo topico × 7gg. Oppure Meclon® che copre BV+Candida in formulazione unica" });
      }
      tx.alerts.forEach(a => results.alerts.push(a));
    } else {
      // ═══ TERAPIA EMPIRICA — senza tampone o in attesa risultato ═══
      const sd = sintomiVaginaliDettaglio;
      if (sd === "asintomatica") {
        results.diagnosi.push({ label: "Asintomatica — tampone non disponibile", severity: "info", detail: "Se asintomatica: non trattare. Richiedere tampone cervicovaginale per valutazione mirata" });
        results.alerts.push({ type: "info", text: "Screening BV asintomatica basso rischio: NON raccomandato (USPSTF 2020). Solo se precedente PTB <20s" });
      } else if (!sd && sintomiVaginali === "si") {
        // Sintomi presenti ma pattern non specificato → tratta come aspecifico
        results.diagnosi.push({ label: "TERAPIA EMPIRICA — sintomi aspecifici, tampone non disponibile", severity: "warning", detail: "Pattern clinico non specificato. Richiedere SEMPRE tampone per conferma. Trattamento empirico a copertura ampia" });
        results.protocollo.push({ label: "Copertura empirica ampia (pattern non specificato)", items: [
          { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2v/die × 7 giorni", notes: "Copre BV + Trichomonas + anaerobi. Sicuro tutti i trimestri (CDC 2021)" },
          { drug: "Clotrimazolo (Canesten®) crema 1%", dose: "5g intravaginale × 7 giorni", notes: "Copre Candida in associazione" },
        ]});
        results.protocollo.push({ label: "ALTERNATIVA: Associazioni vaginali commerciali (pratica IT, non LG internazionali)", items: [
          { drug: "Meclon® (metronidazolo 500mg + clotrimazolo 100mg)", dose: "1 ovulo intravag/die × 6-10 giorni", notes: "Copre BV + Candida. Prodotto più venduto in IT" },
          { drug: "Macmiror Complex® (nifuratel 500mg + nistatina 200.000 UI)", dose: "1 ovulo intravag/die × 8-10 giorni", notes: "Alternativa. Copre Trichomonas + Candida" },
        ]});
        results.alerts.push({ type: "warning", text: "Tampone cervicovaginale OBBLIGATORIO: BV (Amsel/Nugent), coltura Candida, PCR CT/NG, Mycoplasma/Ureaplasma. La terapia empirica è un PONTE, non il trattamento definitivo" });
        results.alerts.push({ type: "info", text: "Se sospetto CT/NG (partner a rischio, cervicite mucopurulenta): aggiungere Zitromax® 1g ± Rocefin® 500mg IM" });
      } else if (!sd) {
        results.diagnosi.push({ label: "Nessun sintomo vaginale specificato", severity: "info", detail: "Specificare i sintomi per ricevere una terapia empirica mirata, oppure attendere il tampone" });
      } else {
        results.diagnosi.push({ label: "TERAPIA EMPIRICA — in attesa di tampone", severity: "warning", detail: "Trattamento basato sul pattern clinico. Richiedere SEMPRE tampone per conferma e antibiogramma" });

        if (sd === "prurito_cagliata") {
          results.protocollo.push({ label: "Pattern: prurito + perdite biancastre/cagliata → Sospetta CANDIDOSI", items: [
            { drug: "Clotrimazolo (Canesten®) crema 1%", dose: "5g intravaginale × 7 giorni", notes: "1ª scelta. Solo TOPICI in gravidanza (CDC 2021)" },
            { drug: "Miconazolo (Daktarin®) ovuli 100mg", dose: "1 ovulo intravaginale × 7 giorni", notes: "Alternativa topica" },
            { drug: "Gynocanesten® (clotrimazolo 100mg cp vaginali)", dose: "1 cp intravag/die × 6 giorni", notes: "Stessa molecola del Canesten® crema, formulazione in compresse" },
            { drug: "Mycostatin® (nistatina 100.000 UI cp vaginali)", dose: "1-2 cp intravag/die × 14 giorni", notes: "Per C. non-albicans resistente agli azolici" },
          ]});
          results.alerts.push({ type: "danger", text: "Fluconazolo orale CONTROINDICATO a qualsiasi dose (ToF OR 3,16 NEJM 2013; aborto aOR 2,23 CMAJ 2019)" });
          results.alerts.push({ type: "warning", text: "Cicli 7 giorni in gravidanza (non 3 come nella non-gravida). Se recidiva: 14 giorni" });
        }

        if (sd === "odore_grigiastre") {
          results.protocollo.push({ label: "Pattern: odore di pesce + perdite grigiastre omogenee → Sospetta BV", items: [
            { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2 volte/die × 7 giorni", notes: "1ª scelta. Sicuro in TUTTI i trimestri (Burtin AJOG 1995: OR 0,93; CDC 2021)" },
            { drug: "Alternativa topica: Dalacin® crema vag 2%", dose: "5g intravag con applicatore × 7 giorni", notes: "Se intolleranza GI al metronidazolo orale. O Zidoval® gel 0,75% 5g intravag × 5gg" },
          ]});
          results.alerts.push({ type: "info", text: "Conferma: sniff test (KOH) positivo, clue cells al microscopio, pH >4,5 (criteri di Amsel)" });
          if (precedentePTB) {
            results.alerts.push({ type: "warning", text: "Precedente PTB: trattare anche se asintomatica se BV confermata <20 settimane" });
          }
        }

        if (sd === "gialloverdastre_maleodoranti") {
          results.protocollo.push({ label: "Pattern: perdite giallo-verdastre schiumose → Sospetta TRICHOMONAS / Infezione mista", items: [
            { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2 volte/die × 7 giorni", notes: "Copre sia Trichomonas che BV" },
          ]});
          results.alerts.push({ type: "danger", text: "Trichomonas ASINTOMATICA: NON trattare (Klebanoff NEJM 2001: PTB ↑). Trattare SOLO le sintomatiche" });
          results.alerts.push({ type: "warning", text: "ESSENZIALE: tampone per conferma. Se Trichomonas confermata → trattare partner (metronidazolo 2g singola)" });
        }

        if (sd === "cervicite_mucopurulenta") {
          results.protocollo.push({ label: "Pattern: cervicite mucopurulenta → Sospetta CT ± NG — Trattare ENTRAMBE empiricamente", items: [
            { drug: "Azitromicina (Zitromax®)", dose: "1g per os dose singola", notes: "Copre Chlamydia (CDC 2021)" },
            { drug: "Ceftriaxone (Rocefin®)", dose: ceftriaxoneNGDose, notes: "Copre Gonorrea. Aggiungere se prevalenza locale NG >5% o rischio elevato" },
          ]});
          if (allergiaAlto) {
            results.alerts.push({ type: "danger", text: "Allergia alto rischio β-latt + sospetta gonorrea: consulenza infettivologica per desensibilizzazione (CDC)" });
          }
          results.alerts.push({ type: "warning", text: "NAAT per CT/NG PRIMA del trattamento. Test of cure CT a 4 settimane. Retest 3 mesi. Trattare partner" });
        }

        if (sd === "mista_aspecifica") {
          results.protocollo.push({ label: "Pattern aspecifico / misto — Copertura empirica ampia in attesa del tampone", items: [
            { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2v/die × 7 giorni", notes: "Copre BV + Trichomonas + anaerobi" },
            { drug: "Clotrimazolo (Canesten®) crema 1%", dose: "5g intravaginale × 7 giorni", notes: "Copre Candida in associazione" },
          ]});
          results.protocollo.push({ label: "ALTERNATIVA: Associazioni vaginali commerciali (pratica e compliance ↑)", items: [
            { drug: "Meclon® (metronidazolo 500mg + clotrimazolo 100mg)", dose: "1 ovulo intravag/die × 6-10 giorni", notes: "Copre BV + Candida + Trichomonas. Prodotto più venduto in IT (1,7M confezioni/anno)" },
            { drug: "Macmiror Complex® (nifuratel 500mg + nistatina 200.000 UI)", dose: "1 ovulo intravag/die × 8-10 giorni", notes: "Copre BV + Candida + Trichomonas. Alternativa se intolleranza metronidazolo topico" },
          ]});
          results.alerts.push({ type: "info", text: "Altre formulazioni topiche: Gynocanesten® (clotrimazolo cp vag 100mg × 6gg), Gyno-Pevaryl® (econazolo 150mg × 6gg in grav), Dalacin® crema vag 2% (clindamicina 5g × 7gg per BV), Zidoval® (metronidazolo gel 0,75% 5g × 5gg per BV)" });
          results.alerts.push({ type: "warning", text: "Pattern aspecifico: richiedere SEMPRE tampone completo (incluso PCR per CT/NG e coltura per Mycoplasma/Ureaplasma)" });
        }

        results.alerts.push({ type: "info", text: "Richiedere tampone cervicovaginale per conferma diagnostica e adattamento mirato della terapia" });
      }
    }
    results.fonti.push("CDC STI GL 2021", "BASHH 2019", "Cochrane");
    return results;
  }

  // ═══ pPROM ═══
  if (scenario === "pprom") {
    const fase = data.fasePprom; // "conservativa" | "travaglio_in_latenza" | "travaglio_post_latenza"
    results.diagnosi.push({ label: `pPROM a ${eg} settimane${fase ? ` — ${fase === "conservativa" ? "gestione conservativa" : fase === "travaglio_esordio" ? "TRAVAGLIO — antibiotici da iniziare" : fase === "travaglio_in_latenza" ? "TRAVAGLIO durante latenza antibiotica" : fase === "travaglio_in_latenza_os" ? "TRAVAGLIO durante fase orale latenza" : "TRAVAGLIO dopo completamento latenza"}` : ""}`, severity: "danger", detail: `Membrane rotte pretermine — gestione ${periviabile ? "periviabile: counselling" : latePreterm ? "late preterm: ACOG vs RCOG divergono" : "conservativa standard"}` });

    if (periviabile) {
      results.alerts.push({ type: "danger", text: `EG ${eg}s: counselling con la coppia. Opzioni: interruzione vs gestione conservativa (SMFM CS #71 2024)` });
      results.alerts.push({ type: "info", text: "Se conservativa: antibiotici latenza solo per 1ª settimana. CCS da 23s se parto previsto entro 7gg" });
    }

    // ═══ FASE A: GESTIONE CONSERVATIVA — regime latenza ═══
    if (!fase || fase === "conservativa") {
      if (!allergiaBetalatt && !allergiaMacrolidi) {
        results.protocollo.push({ label: "Regime B — con Azitromicina (raccomandato)", items: [
          { drug: "Amplital® + Zitromax®", dose: "Amplital® 2g IV ogni 6h × 48h + Zitromax® 1g OS dose singola (gg 1-2)", notes: "Seaman AJOG 2022: azitro > eritro (OR corio 0,53)" },
          { drug: "Zimox®", dose: "500mg per os ogni 8h × 5 giorni (gg 3-7). Totale ciclo: 7 giorni", notes: "Totale: 7 giorni" },
        ]});
      } else if (!allergiaBetalatt && allergiaMacrolidi) {
        results.protocollo.push({ label: "Regime senza macrolidi (allergia/intolleranza azitro-eritro)", items: [
          { drug: "Amplital®", dose: "2g IV ogni 6h × 48h (gg 1-2). Senza macrolide", notes: "Senza macrolide — beneficio ridotto. Consulenza infettivologica" },
          { drug: "Zimox® 500mg per os ogni 8h × 5gg", dose: "Fase OS (gg 3-7)", notes: "Totale: 7 giorni" },
        ]});
        results.alerts.push({ type: "warning", text: "Allergia macrolidi: regime senza azitro/eritro offre beneficio ridotto. Consulenza infettivologica consigliata" });
      } else if (allergiaBasso) {
        results.protocollo.push({ label: "Regime allergia β-latt basso rischio", items: [
          { drug: "Cefamezin® 1g IV ogni 8h" + (allergiaMacrolidi ? "" : " + Zitromax® 1g OS"), dose: "IV × 48h (gg 1-2). Cross-reattività cefalosporine ~1-2%" },
          { drug: "Keforal®", dose: "500mg per os ogni 6h × 5 giorni (gg 3-7). Totale ciclo: 7 giorni", notes: "Totale: 7 giorni" },
        ]});
      } else {
        results.protocollo.push({ label: "Regime allergia alto rischio (anafilassi)", items: [
          { drug: "Dalacin® 900mg IV ogni 8h" + (allergiaMacrolidi ? "" : " + Zitromax® 1g OS"), dose: "IV × 48h (gg 1-2). Sottodosaggio PK possibile (Muller 2010)" },
          { drug: "Dalacin®", dose: "300mg per os ogni 8h × 5 giorni (gg 3-7). Totale ciclo: 7 giorni", notes: "Totale: 7 giorni" },
        ]});
      }

      results.alerts.push({ type: "danger", text: "Amox-clavulanato (Augmentin®) MAI nella pPROM — NEC 1,9% vs 0,5% (ORACLE I Kenyon 2001)" });
      results.alerts.push({ type: "danger", text: "Durata DEFINITA: 7 giorni (ACOG) o max 10gg (RCOG). MAI 'fino al parto'" });

      // GBS notes for conservativa
      if (gbsStatus === "positivo" || batteriuriaGBS) {
        results.alerts.push({ type: "warning", text: "GBS POSITIVO: l'ampicillina IV della fase di attacco copre già il GBS nelle prime 48h. Se il travaglio inizia DOPO il completamento → IAP separata" });
      } else if (gbsStatus === "ignoto" || !gbsStatus) {
        results.alerts.push({ type: "info", text: "GBS ignoto: fare tampone VR ORA all'ammissione. Se travaglio durante fase IV → la copertura GBS è in atto. Se travaglio dopo → IAP empirica (pretermine = FR)" });
      } else {
        results.alerts.push({ type: "info", text: "GBS negativo: se tampone valido (<5 sett), no IAP al travaglio. Se scaduto (>5 sett di latenza) → ripetere" });
      }
    }

    // ═══ FASE B0: TRAVAGLIO — pPROM APPENA DIAGNOSTICATA, ABX NON INIZIATI ═══
    if (fase === "travaglio_esordio") {
      results.diagnosi.push({ label: "TRAVAGLIO + pPROM appena diagnosticata — antibiotici NON ancora iniziati", severity: "danger",
        detail: "Iniziare SUBITO il regime di latenza: la prima dose IV copre contemporaneamente la latenza E la IAP GBS. NON servono due regimi separati" });

      if (!allergiaBetalatt && !allergiaMacrolidi) {
        results.protocollo.push({ label: "INIZIARE ORA — Latenza pPROM (copre anche GBS)", items: [
          { drug: "Amplital® 2g IV", dose: "Prima dose SUBITO, poi ogni 6h fino al parto", notes: "L'ampicillina 2g IV ogni 6h è adeguata sia per latenza che per IAP GBS (CDC 2010; ACOG CO #797)" },
          { drug: "Zitromax® 1g per os", dose: "Dose singola ORA, contemporanea alla prima dose IV", notes: "Copertura macrolide per la latenza (Seaman AJOG 2022)" },
        ]});
        results.alerts.push({ type: "danger", text: "⚠ NON prescrivere Penicillina G separata per IAP GBS. L'ampicillina 2g IV ogni 6h che stai già dando COPRE il GBS. Due regimi sovrapposti sono inutili e confusionanti" });
      } else if (allergiaAlto) {
        results.protocollo.push({ label: "INIZIARE ORA — Allergia alto rischio", items: [
          { drug: "Dalacin® 900mg IV ogni 8h", dose: "Prima dose SUBITO, poi ogni 8h fino al parto", notes: "Se GBS sensibile a clindamicina" },
          ...(!allergiaMacrolidi ? [{ drug: "Zitromax® 1g per os", dose: "Dose singola ORA", notes: "Copertura macrolide per la latenza" }] : []),
        ]});
        if (gbsStatus === "positivo" || gbsStatus === "ignoto" || !gbsStatus) {
          const gbsClindaR = !tamponeCV_ABG || tamponeCV_ABG.clindamicina !== "S"; // non_testata/R/null → vancomicina per precauzione (ACOG CO #797)
          if (gbsClindaR) {
            results.alerts.push({ type: "danger", text: "GBS: clindamicina " + (tamponeCV_ABG?.clindamicina === "R" ? "RESISTENTE" : "sensibilità NON NOTA") + ". ACOG CO #797 raccomanda vancomicina: " + (pesoKg ? `Vancotex® ${Math.min(2000, Math.round(pesoKg * 20 / 100) * 100)}mg` : "Vancotex® 20mg/kg") + " IV ogni 8h (infusione ≥1h)" + (tamponeCV_ABG?.clindamicina !== "R" ? ". NB: non significa che il ceppo sia resistente — la sensibilità è semplicemente non disponibile. Richiedere ABG al laboratorio" : "") });
          }
        }
      } else {
        // Allergia basso rischio
        results.protocollo.push({ label: "INIZIARE ORA — Allergia basso rischio", items: [
          { drug: "Cefamezin® 1g IV ogni 8h", dose: "Prima dose SUBITO, poi ogni 8h fino al parto", notes: "Copre anche GBS" },
          ...(!allergiaMacrolidi ? [{ drug: "Zitromax® 1g per os", dose: "Dose singola ORA", notes: "Copertura macrolide" }] : []),
        ]});
      }

      results.alerts.push({ type: "warning", text: "Obiettivo IAP: ≥4h di antibiotico con copertura GBS prima del parto. Anche 2h = beneficio parziale. MAI ritardare intervento urgente per completare IAP" });
      results.alerts.push({ type: "info", text: "Se il travaglio si arresta: hai già iniziato la latenza → prosegui il ciclo 7gg (Amplital® IV 48h → Zimox® OS 5gg)" });
      results.alerts.push({ type: "info", text: "Post-parto vaginale: 1 dose antibiotica poi STOP. Post-TC: aggiungere Dalacin® 900mg IV al clampaggio (copertura anaerobi) → continuare fino apiressia ≥24h" });

      // GBS tampone all'ammissione
      if (!gbsStatus || gbsStatus === "ignoto") {
        results.alerts.push({ type: "warning", text: "Prelevare tampone vagino-rettale per GBS ORA (anche se il risultato non sarà disponibile prima del parto — serve per la gestione neonatale)" });
      }

      // Neonatologo
      results.alerts.push({ type: "warning", text: "Avvisare neonatologo: pretermine 33s + pPROM + IAP inadeguata (<4h) → EOS risk assessment neonatale (AAP Puopolo 2019)" });

      results.monitoraggio.push("CTG continuo in travaglio", "Emocromo + PCR all'ammissione", "Temperatura ogni 2h — se ≥38°C → sospettare corioamnionite");
    }

    // ═══ FASE B: TRAVAGLIO DURANTE LA LATENZA (prime 48h IV) ═══
    if (fase === "travaglio_in_latenza") {
      results.diagnosi.push({ label: "TRAVAGLIO durante fase IV della latenza", severity: "warning", detail: "Ampicillina 2g IV ogni 6h è già in corso" });

      if (!allergiaBetalatt) {
        // Ampicillina IV copre GBS
        results.protocollo.push({ label: "Antibiotici IN CORSO — Amplital® 2g IV ogni 6h", items: [
          { drug: "Amplital® 2g IV ogni 6h", dose: "CONTINUARE fino al parto", notes: "La dose di ampicillina 2g IV ogni 6h è ADEGUATA per IAP GBS (CDC 2010, nota §)" },
        ]});
        if (gbsStatus === "positivo" || batteriuriaGBS || gbsStatus === "ignoto" || !gbsStatus) {
          results.alerts.push({ type: "info", text: "IAP GBS: NON necessario aggiungere Penicillina G. L'ampicillina 2g IV ogni 6h già in corso copre il GBS (CDC GBS GL 2010: 'antibiotics given for latency that include ampicillin 2g IV are adequate for GBS prophylaxis')" });
        }
        if (gbsStatus === "negativo") {
          results.alerts.push({ type: "info", text: "GBS negativo: continuare ampicillina come latenza. Non serve IAP aggiuntiva" });
        }
      } else if (allergiaBasso) {
        results.protocollo.push({ label: "In corso: Cefamezin® 1g IV ogni 8h", items: [
          { drug: "Cefamezin® 1g IV ogni 8h", dose: "CONTINUARE", notes: "Cefazolina copre GBS — adeguata anche come IAP" },
        ]});
        results.alerts.push({ type: "info", text: "Cefazolina in corso: copre già il GBS. Non serve aggiungere IAP separata" });
      } else {
        // Allergia alto rischio — clindamicina in corso
        results.protocollo.push({ label: "In corso: Dalacin® 900mg IV ogni 8h", items: [
          { drug: "Dalacin® 900mg IV ogni 8h", dose: "CONTINUARE", notes: "Clindamicina NON copre GBS se ceppo resistente o sensibilità ignota" },
        ]});
        if (gbsStatus === "positivo" || batteriuriaGBS || gbsStatus === "ignoto" || !gbsStatus) {
          const gbsSensClinda = tamponeCV_ABG && tamponeCV_ABG.clindamicina === "S";
          if (gbsSensClinda) {
            results.alerts.push({ type: "info", text: "GBS sensibile a clindamicina: Dalacin® in corso è adeguato per IAP (ma possibile sottodosaggio PK)" });
          } else {
            results.alerts.push({ type: "danger", text: "GBS resistente a clindamicina o sensibilità ignota: AGGIUNGERE Vancomicina per IAP GBS" });
            results.protocollo.push({ label: "AGGIUNGERE IAP GBS — Vancomicina", items: [
              { drug: "Vancomicina (Vancotex®)", dose: vancoDosingStr, notes: "In AGGIUNTA alla clindamicina di latenza" },
            ]});
          }
        }
      }
      results.alerts.push({ type: "warning", text: "Obiettivo: ≥4h di antibiotico con copertura GBS prima del parto. Anche 2h = beneficio parziale. MAI ritardare intervento urgente" });
    }

    // ═══ FASE B2: TRAVAGLIO DURANTE FASE ORALE (gg 3-7) ═══
    if (fase === "travaglio_in_latenza_os") {
      results.diagnosi.push({ label: "TRAVAGLIO durante fase ORALE della latenza (gg 3-7)", severity: "warning", detail: "Gestione dipende dallo stato GBS: se negativo → continuare orale; se positivo/ignoto → switch a IV per IAP" });

      const needsIAP = gbsStatus === "positivo" || batteriuriaGBS || precedenteNeonatoGBS || gbsStatus === "ignoto" || !gbsStatus;

      if (needsIAP) {
        // GBS positivo o ignoto → SWITCH a IV per IAP (l'orale non copre GBS a livello terapeutico)
        results.diagnosi.push({ label: "IAP GBS INDICATA — SWITCH da orale a IV", severity: "danger", detail: `${gbsStatus === "positivo" ? "GBS positivo" : batteriuriaGBS ? "Batteriuria GBS" : precedenteNeonatoGBS ? "Precedente neonato GBS" : "GBS ignoto + pretermine = FR automatico"} — l'amoxicillina OS non fornisce concentrazioni adeguate per IAP` });
        results.protocollo.push({ label: "SOSPENDERE orale → SWITCH a regime IV (IAP + copertura latenza)", items: [] });
        if (!allergiaBetalatt) {
          results.protocollo[results.protocollo.length-1].items.push(
            { drug: "Ampicillina (Amplital®)", dose: "2g IV carico → 1g IV ogni 4h fino al parto", notes: "Copre contemporaneamente IAP GBS + prosecuzione copertura latenza. Regime unico" }
          );
        } else if (allergiaBasso) {
          results.protocollo[results.protocollo.length-1].items.push(
            { drug: "Cefazolina (Cefamezin®)", dose: "2g IV carico → 1g ogni 8h", notes: "Copre GBS + prosecuzione copertura latenza" }
          );
        } else {
          const gbsSensClinda = tamponeCV_ABG && tamponeCV_ABG.clindamicina === "S";
          if (gbsSensClinda) {
            results.protocollo[results.protocollo.length-1].items.push(
              { drug: "Clindamicina (Dalacin®)", dose: "900mg IV ogni 8h", notes: "GBS sensibile. Prosegue latenza + IAP. Possibile sottodosaggio PK (Muller 2010)" }
            );
          } else {
            results.protocollo[results.protocollo.length-1].items.push(
              { drug: "Clindamicina (Dalacin®)", dose: "900mg IV ogni 8h", notes: "Prosecuzione latenza" },
              { drug: "Vancomicina (Vancotex®)", dose: vancoDosingStr, notes: "IAP GBS (ceppo R/ignoto clindamicina)" }
            );
          }
        }
        results.alerts.push({ type: "warning", text: "Obiettivo: ≥4h di IAP IV prima del parto. Anche 2h = beneficio parziale. MAI ritardare intervento urgente per IAP" });
      } else {
        // GBS NEGATIVO → continuare latenza orale, NO switch a IV, NO IAP
        results.protocollo.push({ label: "GBS NEGATIVO — CONTINUARE latenza orale durante il travaglio", items: [
          { drug: "Proseguire antibiotico orale in corso (Zimox®/Keforal®/Dalacin® OS)", dose: "Completare il ciclo di 7 giorni se tollerato", notes: "Il beneficio anti-infettivo (non-GBS) della latenza persiste. ACOG CO #797: dopo 3gg di latenza con ampicillina iniziale, GBS è probabilmente eradicato" },
        ]});
        results.alerts.push({ type: "info", text: "GBS negativo con tampone valido (<5 sett): NON serve IAP, NON serve switch a IV. Proseguire latenza orale se tollerata. Se vomito o travaglio avanzato: la sospensione a gg 5-6 di 7 è ragionevole" });
        results.alerts.push({ type: "info", text: "Nessuna LG affronta esplicitamente questo scenario. Il razionale clinico è: la funzione 'prolungamento gravidanza' è moot in travaglio, ma la funzione 'riduzione infezioni' può ancora avere valore residuo (Mercer JAMA 1997, Cochrane CD001058)" });
      }
    }

    // ═══ FASE C: TRAVAGLIO DOPO COMPLETAMENTO LATENZA ═══
    if (fase === "travaglio_post_latenza") {
      results.diagnosi.push({ label: "TRAVAGLIO dopo completamento latenza (antibiotici SOSPESI)", severity: "warning", detail: "Latenza completata da ≥1 giorno. Necessaria IAP GBS separata se indicata" });

      const needsIAP = gbsStatus === "positivo" || batteriuriaGBS || precedenteNeonatoGBS || gbsStatus === "ignoto" || !gbsStatus; // pretermine = FR automatico
      if (needsIAP) {
        results.diagnosi.push({ label: "IAP GBS INDICATA", severity: "danger", detail: `${gbsStatus === "positivo" ? "GBS positivo" : batteriuriaGBS ? "Batteriuria GBS" : precedenteNeonatoGBS ? "Precedente neonato GBS" : "GBS ignoto + parto pretermine (= FR automatico)"}` });
        if (!allergiaBetalatt) {
          results.protocollo.push({ label: "IAP GBS — latenza completata, regime separato", items: [
            { drug: "Penicillina G (sodica)", dose: "5 MUI IV carico → 2,5-3 MUI ogni 4h fino al parto", notes: "1ª scelta LG (spettro ristretto)" },
            { drug: "Alternativa pratica: Amplital® (ampicillina)", dose: "2g IV carico → 1g IV ogni 4h fino al parto", notes: "Stessa efficacia IAP. Disponibile in tutte le sale parto" },
          ]});
        } else if (allergiaBasso) {
          results.protocollo.push({ label: "IAP GBS — allergia basso rischio", items: [
            { drug: "Cefazolina (Cefamezin®)", dose: "2g IV carico → 1g ogni 8h", notes: "" },
          ]});
        } else {
          const gbsSensClinda = tamponeCV_ABG && tamponeCV_ABG.clindamicina === "S";
          results.protocollo.push({ label: `IAP GBS — allergia alto rischio`, items: [
            gbsSensClinda
              ? { drug: "Clindamicina (Dalacin®)", dose: "900mg IV ogni 8h", notes: "GBS sensibile. Possibile sottodosaggio PK" }
              : { drug: "Vancomicina (Vancotex®)", dose: vancoDosingStr, notes: "GBS R/ignoto clindamicina" },
          ]});
        }
        results.alerts.push({ type: "warning", text: "Obiettivo: ≥4h di IAP prima del parto. Anche 2h = beneficio parziale" });
      } else {
        // GBS negativo con tampone valido
        results.protocollo.push({ label: "Gestione travaglio", items: [
          { drug: "Nessun antibiotico", dose: "GBS negativo con tampone valido (<5 settimane)", notes: "Se tampone >5 settimane dalla latenza: ripetere o IAP empirica" },
        ]});
      }
      // Check if new infection signs
      results.alerts.push({ type: "info", text: "Se NUOVI segni di infezione (febbre, tachicardia fetale, leucocitosi): nuovo ciclo antibiotico completo, NON ripresa della latenza precedente" });
    }

    // ═══ CERCHIAGGIO ═══
    if (cerchiaggio) {
      results.alerts.push({ type: "warning", text: "CERCHIAGGIO IN SITU: rimozione raccomandata nella pPROM (ACOG PB #217). Eccezione: periviabilità con gestione conservativa — decisione individualizzata. Dopo rimozione: iniziare subito antibiotici e CCS" });
    }

    if (eg >= 24 && eg < 34 && (!fase || fase === "conservativa")) {
      results.monitoraggio.push("CCS: Betametasone (Bentelan®) 12mg IM ×2 a distanza di 24h");
      if (eg < 32) results.monitoraggio.push("MgSO₄ per neuroprotezione se parto previsto <32s (ACOG CO #455)");
    }
    if (!fase || fase === "conservativa") {
      results.monitoraggio.push("Tocolisi SOLO per 48h per CCS: Atosiban (Tractocile®) o Nifedipina (Adalat®)", "Monitoraggio: CTG, emocromo+PCR ogni 24-48h, temperatura ogni 4-6h");
    }
    results.fonti.push("Mercer JAMA 1997", "ACOG PB #217 2020", "Seaman AJOG 2022", "ORACLE I Kenyon Lancet 2001", "CDC GBS GL 2010 (nota §)", "ACOG CO #797 2020");
    return results;
  }

  // ═══ PROM A TERMINE ═══
  if (scenario === "promTermine") {
    results.diagnosi.push({ label: `PROM a termine (${eg}s)`, severity: "warning", detail: "NO antibiotici di latenza. Solo IAP GBS se indicata" });

    if (gbsStatus === "positivo" || precedenteNeonatoGBS || batteriuriaGBS) {
      const gbsReasons = [];
      if (gbsStatus === "positivo") gbsReasons.push("Tampone positivo");
      if (batteriuriaGBS) gbsReasons.push("Batteriuria GBS");
      if (precedenteNeonatoGBS) gbsReasons.push("Precedente neonato con malattia GBS invasiva");
      results.diagnosi.push({ label: "GBS POSITIVO — IAP indicata", severity: "danger", detail: gbsReasons.join(" + ") });
      results.alerts.push({ type: "danger", text: "Induzione raccomandata. IAP immediata" });
      if (!allergiaBetalatt) {
        results.protocollo.push({ label: "IAP GBS — 1ª scelta", items: [
          { drug: "Penicillina G (sodica)", dose: "5 MUI IV carico → 2,5-3 MUI ogni 4h fino al parto", notes: "1ª scelta LG — spettro ristretto = meno resistenze" },
          { drug: "Alternativa: Amplital® (ampicillina)", dose: "2g IV carico → 1g IV ogni 4h fino al parto", notes: "Stessa efficacia per IAP GBS. Più disponibile in IT" },
        ]});
      } else if (allergiaBasso) {
        results.protocollo.push({ label: "IAP GBS — allergia basso rischio", items: [
          { drug: "Cefazolina (Cefamezin®)", dose: "2g IV carico → 1g ogni 8h", notes: "Cross-reattività ~1-2%" },
        ]});
      } else {
        const gbsSensClinda = tamponeCV_ABG && tamponeCV_ABG.clindamicina === "S";
        if (gbsSensClinda) {
          results.protocollo.push({ label: "IAP GBS — allergia alto rischio, GBS sensibile clindamicina", items: [
            { drug: "Clindamicina (Dalacin®)", dose: "900mg IV ogni 8h", notes: "Possibile sottodosaggio PK (Muller 2010)" },
          ]});
        } else {
          results.protocollo.push({ label: "IAP GBS — allergia alto rischio, GBS R/ignoto clindamicina", items: [
            { drug: "Vancomicina (Vancotex®)", dose: vancoDosingStr, notes: "Weight-based ACOG 2020. RCOG: 1g q12h fisso" },
          ]});
        }
      }
    } else if (gbsStatus === "negativo" && !batteriuriaGBS) {
      results.diagnosi.push({ label: "GBS NEGATIVO — no IAP", severity: "info", detail: "Se tampone valido (<5 settimane)" });
      results.protocollo.push({ label: "Gestione", items: [
        { drug: "Nessun antibiotico", dose: "Attesa 12-24h O induzione", notes: "Entrambe accettabili (ACOG/NICE)" },
      ]});
    } else {
      // GBS ignoto
      const rotturaLunga = oreRottura && oreRottura >= 18;
      results.diagnosi.push({ label: "GBS IGNOTO", severity: "warning", detail: `Decisione basata su fattori di rischio e durata rottura${oreRottura ? ` (${oreRottura}h)` : ""}` });
      if (rotturaLunga || febbre || pretermine) {
        results.alerts.push({ type: "danger", text: `IAP EMPIRICA indicata: ${rotturaLunga ? `rottura ≥18h (${oreRottura}h)` : ""}${febbre ? " + febbre" : ""}${pretermine ? " + pretermine" : ""} (ACOG CO #797)` });
        if (!allergiaBetalatt) {
          results.protocollo.push({ label: "IAP empirica (GBS ignoto + fattori di rischio)", items: [
            { drug: "Penicillina G (sodica) o Amplital® (ampicillina)", dose: "Pen G: 5 MUI IV → 2,5-3 MUI/4h OPPURE Amplital® 2g IV → 1g/4h", notes: "Fino al parto. Come GBS positiva" },
          ]});
        } else if (allergiaBasso) {
          results.protocollo.push({ label: "IAP empirica — allergia basso rischio", items: [
            { drug: "Cefazolina (Cefamezin®)", dose: "2g IV carico → 1g ogni 8h fino al parto", notes: "Cross-reattività ~1-2% (ACOG CO #797)" },
          ]});
        } else {
          const gbsSensClinda = tamponeCV_ABG && tamponeCV_ABG.clindamicina === "S";
          results.protocollo.push({ label: `IAP empirica — allergia alto rischio`, items: [
            gbsSensClinda
              ? { drug: "Clindamicina (Dalacin®)", dose: "900mg IV ogni 8h fino al parto", notes: "Se GBS sensibile a clindamicina" }
              : { drug: "Vancomicina (Vancotex®)", dose: vancoDosingStr, notes: "GBS R/ignoto clindamicina. Weight-based (ACOG CO #797)" },
          ]});
        }
      } else if (oreRottura && oreRottura < 18) {
        results.alerts.push({ type: "info", text: `Rottura ${oreRottura}h (<18h), no FR: gestire come GBS negativa (SIGO 2025). Rivalutare a 18h` });
      } else {
        results.alerts.push({ type: "warning", text: "GBS ignoto: inserire ORE DALLA ROTTURA per decisione IAP. Soglia: 18h (ACOG CO #797)" });
      }
      if (gbsPrecedenteGrav) {
        results.alerts.push({ type: "warning", text: "GBS+ in gravidanza precedente: 50% probabilità di colonizzazione attuale (OR 6,05). ACOG: 'considerare' IAP se GBS ignoto a ≥37s" });
      }
    }
    results.alerts.push({ type: "info", text: "NICE NG207: induzione a 24h dalla rottura se travaglio non iniziato spontaneamente" });
    results.fonti.push("ACOG PB #217 2020", "ACOG CO #797 2020", "SIGO Induzione ott 2025", "NICE NG207 2021");
    return results;
  }

  // ═══ TRAVAGLIO (GBS IAP) ═══
  if (scenario === "travaglio") {
    // ═══ DISTINGUISH TPL (preterm) vs TERM LABOR ═══
    if (pretermine) {
      results.diagnosi.push({ label: `Travaglio pretermine a ${eg} settimane — membrane ${membraneStatus === "integre" ? "INTEGRE" : membraneStatus ? "rotte" : "stato da verificare"}`,
        severity: "danger", detail: "TPL = minaccia di parto pretermine. La gestione antibiotica dipende SOLO dallo stato GBS. NO antibiotici di latenza a membrane integre" });
    }

    if (membraneStatus === "integre" && pretermine) {
      results.alerts.push({ type: "danger", text: "TPP con MEMBRANE INTEGRE: antibiotici di latenza (Mercer) CONTROINDICATI. ORACLE II Kenyon Lancet 2001: follow-up 7aa → PCI (paralisi cerebrale) 3,3% vs 1,7% con eritromicina. L'unico antibiotico indicato è la IAP GBS se lo stato GBS lo richiede" });

      // ═══ NON-ANTIBIOTIC: CCS + Tocolisi + MgSO₄ ═══
      const ccsItems = [];
      if (eg >= 23 && eg < 34) {
        ccsItems.push({ drug: "Betametasone (Bentelan®)", dose: "12mg IM ogni 24h × 2 dosi", notes: "CCS maturazione polmonare. Finestra: 23+0 — 33+6s. Beneficio massimo 24h-7gg dopo 2ª dose" });
      } else if (eg >= 34 && eg < 37) {
        ccsItems.push({ drug: "Betametasone (Bentelan®)", dose: "12mg IM ogni 24h × 2 dosi", notes: "Late preterm CCS (34-36+6): ACOG raccomanda SOLO se no CCS precedenti e parto probabile entro 7gg. SMFM: caso per caso" });
      }
      if (eg < 32) {
        ccsItems.push({ drug: "MgSO₄ — neuroprotezione", dose: "Bolo 4g IV in 20-30min → 1g/h (max 24h)", notes: "Se <32s e parto imminente/probabile. ↓ PCI OR 0,69 (Crowther JAMA 2003). CI: miastenia gravis" });
      }
      if (eg < 34) {
        ccsItems.push({ drug: "Tocolisi — per 48h (per completare CCS)", dose: "Atosiban (Tractocile®) o Nifedipina (Adalat® 20mg) o Indometacina (Indocid® <32s)", notes: "SOLO per permettere CCS. MAI mantenimento. CI: corioamnionite, abruption, travaglio avanzato" });
      }
      if (ccsItems.length > 0) {
        results.protocollo.push({ label: "🫁 Gestione NON antibiotica — CCS / Tocolisi / Neuroprotezione", items: ccsItems });
      }
    }
    if (gbsStatus === "positivo" || precedenteNeonatoGBS || batteriuriaGBS || (gbsStatus === "ignoto" && (pretermine || febbre || (oreRottura && oreRottura >= 18)))) {
      results.diagnosi.push({ label: "IAP GBS INDICATA", severity: "danger", detail: gbsStatus === "positivo" ? "GBS positivo" : batteriuriaGBS ? "Batteriuria GBS" : precedenteNeonatoGBS ? "Precedente neonato GBS" : pretermine && (gbsStatus === "ignoto" || !gbsStatus) ? "GBS ignoto + parto PRETERMINE = fattore di rischio per malattia GBS neonatale (ACOG CO #797)" : `GBS ignoto con FR${oreRottura ? ` (rottura ${oreRottura}h)` : ""}` });
      if (!allergiaBetalatt) {
        results.protocollo.push({ label: "IAP — 1ª scelta", items: [
          { drug: "Penicillina G (sodica)", dose: "5 MUI IV carico → 2,5-3 MUI ogni 4h fino al parto", notes: "1ª scelta LG (ACOG CO #797) — spettro ristretto" },
          { drug: "Alternativa pratica: Amplital® (ampicillina)", dose: "2g IV carico → 1g IV ogni 4h fino al parto", notes: "Equivalente per IAP GBS (ACOG CO #797). Disponibile in tutte le sale parto IT" },
        ]});
      } else if (allergiaBasso) {
        results.protocollo.push({ label: "IAP — allergia basso rischio", items: [
          { drug: "Cefazolina (Cefamezin®)", dose: "2g IV carico → 1g ogni 8h", notes: "" },
        ]});
      } else {
        const sensClinda = tamponeCV_ABG && tamponeCV_ABG.clindamicina === "S";
        results.protocollo.push({ label: `IAP — allergia alto rischio, GBS ${sensClinda ? "sensibile clinda" : "R/ignoto clinda"}`, items: [
          sensClinda
            ? { drug: "Clindamicina (Dalacin®)", dose: "900mg IV ogni 8h", notes: "PK possibilmente subterapeutica" }
            : { drug: "Vancomicina (Vancotex®)", dose: vancoDosingStr, notes: "Weight-based ACOG 2020" },
        ]});
      }
      if (gbsPrecedenteGrav) {
        results.alerts.push({ type: "info", text: "Nota: GBS+ in gravidanza precedente (50% probabilità colonizzazione attuale — OR 6,05). Rafforza l'indicazione alla IAP" });
      }
    } else {
      results.diagnosi.push({ label: "IAP GBS NON INDICATA", severity: "info", detail: "GBS negativo valido (<5 sett) o GBS ignoto senza FR" });
      if (gbsPrecedenteGrav && gbsStatus !== "negativo") {
        results.alerts.push({ type: "warning", text: "GBS+ in gravidanza precedente: 50% probabilità di colonizzazione attuale. ACOG: 'considerare' IAP come decisione condivisa se ≥37s con GBS ignoto" });
      }
    }
    // Notes for preterm labor
    if (pretermine) {
      results.alerts.push({ type: "info", text: "Se il travaglio si ARRESTA (tocolisi efficace): STOP IAP. Riprendere al prossimo episodio. Il tampone GBS prelevato oggi sarà utile per la gestione futura" });
      if (gbsStatus === "negativo") {
        results.alerts.push({ type: "info", text: "GBS negativo → nessun antibiotico. La gestione del TPL a membrane integre è tocolisi + CCS + MgSO₄ (se <32s). Monitoraggio clinico-laboratoristico per escludere infezione subclinica" });
      }
      if (!gbsStatus || gbsStatus === "ignoto") {
        results.alerts.push({ type: "warning", text: "Prelevare tampone vagino-rettale GBS ORA se non disponibile — anche se il risultato non arriverà prima del parto, guiderà la gestione di episodi futuri e la valutazione neonatale" });
      }
    }
    results.fonti.push("ACOG CO #797 2020", "WHO GBS GL 2024", "ORACLE II Kenyon Lancet 2001");
    return results;
  }

  // ═══ INCOMPETENZA CERVICALE / SACCO IN VAGINA ═══
  if (scenario === "incompCervicale") {
    const sottoscenario = data.sottoscenarioIC; // "screening_ic" | "sacco_vagina" | "cerchiaggio_altrove" | null
    const haInfezCV = tamponeCVResult && tamponeCVResult !== "negativo";
    const tampDisp = tamponeDisponibile;

    // ═══ A: SCREENING IC — cervice corta/dilatata, senza sacco, senza cerchiaggio ═══
    if (!sottoscenario || sottoscenario === "screening_ic") {
      results.diagnosi.push({ label: `Incompetenza cervicale a ${eg}s — valutazione e screening infettivo`, severity: "warning",
        detail: "Senza cerchiaggio nel nostro armamentario: lo screening e il trattamento aggressivo delle infezioni è il pilastro terapeutico" });

      // Screening protocol
      results.protocollo.push({ label: "SCREENING INFETTIVO COMPLETO (da eseguire sempre)", items: [
        { drug: "Tampone CV completo", dose: "BV (Amsel/Nugent), Candida con tipizzazione, PCR CT/NG, coltura Mycoplasma/Ureaplasma + antibiogramma", notes: "L'infiammazione cervicale è la causa principale dell'IC (Donders 2020)" },
        { drug: "Urinocoltura + esame urine", dose: "Batteriuria asintomatica: trattare SEMPRE in questo contesto", notes: "Indipendentemente dalla posizione ISS/SNLG sullo screening di routine" },
        { drug: "Tampone vagino-rettale GBS", dose: "Se ≥23 settimane", notes: "Per pianificazione IAP futura" },
        { drug: "PCR + emocromo", dose: "Baseline infettivo", notes: "Per monitoraggio evoluzione" },
      ]});

      // Progesterone
      results.protocollo.push({ label: "Terapia di base — Progesterone vaginale", items: [
        { drug: "Progesterone vaginale (Progeffik®/Crinone®)", dose: "200mg/die intravaginale", notes: "Cochrane + OPPTIMUM trial: riduce PTB in donne con cervice corta" },
      ]});

      // If swab result available → targeted therapy
      if (tampDisp === "si" && haInfezCV) {
        results.diagnosi.push({ label: `INFEZIONE CERVICOVAGINALE IDENTIFICATA: ${tamponeCVResult}`, severity: "danger",
          detail: "In contesto di IC, l'infezione è causa/concausa — trattamento AGGRESSIVO indicato" });

        const treatments = {
          "candida": { label: "Candidosi — trattare e confermare negativizzazione", items: [
            { drug: "Clotrimazolo (Canesten®) crema 1%", dose: "5g intravag × 7gg", notes: "Se C. glabrata: nistatina 14gg. MAI fluconazolo OS" }] },
          "bv": { label: "BV — trattare SEMPRE in contesto IC (anche se asintomatica)", items: [
            { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2v/die × 7gg", notes: "BV + IC = trattamento obbligatorio. Non attendere sintomi (Guerra EJOG 2006)" }] },
          "chlamydia": { label: "Chlamydia — trattare + partner + test of cure", items: [
            { drug: "Azitromicina (Zitromax®)", dose: "1g per os singola", notes: "NAAT 4 sett + retest 3 mesi. Partner simultaneamente" }] },
          "gonorrea": { label: "Gonorrea — trattare + CT empirica", items: [
            { drug: "Ceftriaxone (Rocefin®)", dose: ceftriaxoneNGDose, notes: "Se CT non esclusa: + Zitromax® 1g" }] },
          "m_hominis": { label: "M. hominis — clindamicina (resiste a macrolidi!)", items: [
            { drug: "Clindamicina (Dalacin®)", dose: "300mg per os 3v/die × 7gg", notes: "M. hominis è INTRINSECAMENTE resistente a azitro/eritro" }] },
          "ureaplasma": { label: "Ureaplasma — trattare in contesto IC (eccezione al non-screening)", items: [
            { drug: "Azitromicina (Zitromax®)", dose: "1g per os singola o 500mg g1 + 250mg gg2-5", notes: "In IC con Ureaplasma: il trattamento è giustificato dal contesto clinico" }] },
          "trichomonas": { label: "Trichomonas", items: [
            { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2v/die × 7gg", notes: "Solo se sintomatica. Se asintomatica: rischio-beneficio con la paziente" }] },
        };
        const tx = treatments[tamponeCVResult];
        if (tx) results.protocollo.push(tx);

        results.alerts.push({ type: "danger", text: "CONFERMARE NEGATIVIZZAZIONE: tampone di controllo DOPO completamento terapia. Non considerare il trattamento completato senza la conferma microbiologica" });
        results.alerts.push({ type: "info", text: "Studio ScienceDirect 2025: infezioni trattate → NO ↑ rischio PTB. Il beneficio è indipendente dal cerchiaggio — trattare l'infezione migliora gli esiti comunque" });

      } else if (tampDisp === "no" || tampDisp === "in_attesa") {
        // Empirical if symptomatic
        const sd = sintomiVaginaliDettaglio;
        if (sd && sd !== "asintomatica") {
          results.alerts.push({ type: "warning", text: "Tampone non disponibile ma sintomi presenti: iniziare terapia EMPIRICA (vedi scenario cervicovaginale) e richiedere tampone per conferma" });
        }
        results.alerts.push({ type: "danger", text: "In contesto di IC: richiedere tampone CV COMPLETO è PRIORITARIO — non è uno screening opzionale, è parte integrante della gestione" });
      } else {
        results.alerts.push({ type: "info", text: "Se tampone CV negativo: proseguire con progesterone e monitoraggio cervicometrico. Rivalutare ogni 2 settimane o se sintomi" });
      }

      // Dilatation and membrane considerations
      if (dilatazioneCervicale && dilatazioneCervicale >= 2) {
        results.alerts.push({ type: "danger", text: `Dilatazione ≥2cm (${dilatazioneCervicale}cm): protocollo Barcellona 2024 raccomanda amniocentesi diagnostica per escludere IUI subclinica prima di qualsiasi procedura. Se IUI confermata → antibiotici per IUI + espletamento` });
      }
      results.monitoraggio.push("Cervicometria transvaginale ogni 1-2 settimane", "Tampone CV di controllo dopo trattamento", "Emocromo + PCR seriati se infezione trattata");
    }

    // ═══ B: SACCO IN VAGINA ═══
    if (sottoscenario === "sacco_vagina") {
      const membraneRotte = membraneStatus === "rotte_pretermine" || membraneStatus === "rotte_termine";

      results.diagnosi.push({ label: `Sacco amniotico in vagina a ${eg} settimane`, severity: "danger",
        detail: `Prolasso membrane attraverso OUE. PRIMO STEP: verificare stato membrane (nitrazina, ferning, IGFBP-1, ecografia LA)` });

      if (membraneRotte) {
        // ═══ B1: SACCO + MEMBRANE ROTTE = pPROM CONFERMATA ═══
        results.diagnosi.push({ label: "MEMBRANE ROTTE — pPROM confermata", severity: "danger",
          detail: "Prolasso + rottura = pPROM. Regime antibiotico di latenza INDICATO (Mercer JAMA 1997; ACOG PB #217 2020)" });

        if (!allergiaBetalatt && !allergiaMacrolidi) {
          results.protocollo.push({ label: "Latenza pPROM — regime standard 7 giorni", items: [
            { drug: "Amplital® + Zitromax®", dose: "Amplital® 2g IV ogni 6h × 48h + Zitromax® 1g OS dose singola (gg 1-2)" },
            { drug: "Zimox®", dose: "500mg per os ogni 8h × 5 giorni (gg 3-7). Totale ciclo: 7 giorni" },
          ]});
        } else if (allergiaAlto) {
          results.protocollo.push({ label: "Latenza pPROM — allergia alto rischio", items: [
            { drug: "Dalacin® 900mg IV ogni 8h" + (!allergiaMacrolidi ? " + Zitromax® 1g OS" : ""), dose: "IV × 48h (gg 1-2)" },
            { drug: "Dalacin®", dose: "300mg per os ogni 8h × 5 giorni (gg 3-7). Totale: 7 giorni" },
          ]});
        } else {
          results.protocollo.push({ label: "Latenza pPROM — allergia basso rischio", items: [
            { drug: "Cefamezin® 1g IV ogni 8h" + (!allergiaMacrolidi ? " + Zitromax® 1g OS" : ""), dose: "IV × 48h (gg 1-2)" },
            { drug: "Keforal®", dose: "500mg per os ogni 6h × 5 giorni (gg 3-7). Totale: 7 giorni" },
          ]});
        }
        results.alerts.push({ type: "danger", text: "Amox-clavulanato (Augmentin®): VIETATO nella pPROM (ORACLE I: NEC 1,9% vs 0,5%)" });

      } else {
        // ═══ B2: SACCO + MEMBRANE INTEGRE = IC AVANZATA, NON pPROM ═══
        results.diagnosi.push({ label: membraneRotte === false ? "MEMBRANE INTEGRE — NON è una pPROM" : "Stato membrane da verificare", severity: "warning",
          detail: "Prolasso senza rottura = insufficienza cervicale avanzata. Il regime di latenza tipo Mercer NON è supportato dall'evidenza per membrane integre (ACOG: evidenza insufficiente per antibiotici profilattici senza cerchiaggio)" });

        results.protocollo.push({ label: "Antibiotici: SOLO se infezione documentata o cerchiaggio d'urgenza", items: [
          { drug: "Screening infettivo COMPLETO", dose: "Tampone CV (BV, CT/NG, Mycoplasma, Ureaplasma) + urinocoltura + PCR/emocromo", notes: "PRIMA di qualsiasi terapia antibiotica" },
          { drug: "Se tampone POSITIVO → terapia MIRATA", dose: "Secondo patogeno isolato (vedi scenario cervicovaginale)", notes: "NON regime pPROM empirico — trattare l'infezione specifica" },
          { drug: "Se cerchiaggio d'urgenza pianificato → profilassi perioperatoria", dose: "Cefalosporina (Cefamezin® 2g IV) dose singola all'induzione anestesiologica", notes: "Protocollo Barcellona 2024. NON regime 7 giorni" },
        ]});

        results.alerts.push({ type: "danger", text: "⚠ MEMBRANE INTEGRE: il regime Mercer 7 giorni (Amplital® + Zitromax®) NON è indicato. Tutta l'evidenza sulla latenza è su membrane ROTTE. Trattare SOLO infezioni documentate al tampone (ACOG PB #142; AAFP 2004: evidenza insufficiente per antibiotici profilattici nel cerchiaggio)" });
        results.alerts.push({ type: "warning", text: "Se le membrane si ROMPONO durante l'osservazione → passare IMMEDIATAMENTE al regime di latenza pPROM (Amplital® + Zitromax® 7gg)" });

        if (!membraneStatus) {
          results.alerts.push({ type: "danger", text: "STATO MEMBRANE NON VERIFICATO — eseguire SUBITO: test nitrazina, ferning, IGFBP-1 (Amnisure®), ecografia per indice di LA. La gestione antibiotica cambia radicalmente in base a questo dato" });
        }
      }

      // Sempre, indipendentemente dalle membrane
      results.protocollo.push({ label: "Gestione NON antibiotica (sempre)", items: [
        { drug: "Progesterone vaginale (Progeffik®)", dose: "200mg intravag/die fino a 36+6 sett", notes: "Cochrane + FIGO 2025" },
      ]});
      if (cerchiaggio) {
        results.alerts.push({ type: "warning", text: "Cerchiaggio in situ + sacco in vagina: rimozione se segni di infezione. Se conservativa senza infezione → decisione individualizzata" });
      }
      results.monitoraggio.push("Tampone CV + urinocoltura ALL'AMMISSIONE", "CTG + emocromo/PCR ogni 24-48h", "Temperatura ogni 4-6h",
        "CCS: Bentelan® 12mg IM ×2 se 23-34s", "MgSO₄ se <32s e parto imminente");
      if (eg >= 22 && eg < 24) {
        results.alerts.push({ type: "info", text: `EG ${eg}s (periviabilità): counselling con la coppia su opzioni (conservativa vs interruzione)` });
      }
    }

    // ═══ C: CERCHIAGGIO POSIZIONATO ALTROVE + INFEZIONE ═══
    if (sottoscenario === "cerchiaggio_altrove") {
      results.diagnosi.push({ label: `Cerchiaggio in situ (posizionato altrove) + sospetta infezione a ${eg}s`, severity: "warning",
        detail: "Il cerchiaggio crea un corpo estraneo → facilita biofilm e infezione ascendente. Trattamento aggressivo" });

      results.protocollo.push({ label: "SCREENING come scenario A + trattamento mirato", items: [
        { drug: "Screening completo (vedi sopra)", dose: "Tampone CV + urinocoltura + GBS + emocromo/PCR", notes: "Il cerchiaggio aumenta il rischio di colonizzazione batterica (corpo estraneo + biofilm)" },
      ]});

      if (haInfezCV) {
        results.alerts.push({ type: "danger", text: `Infezione identificata (${tamponeCVResult}) con cerchiaggio in situ: trattamento AGGRESSIVO + monitoraggio stretto. Contattare il centro che ha posizionato il cerchiaggio` });
      }

      results.alerts.push({ type: "warning", text: "Se segni di infezione intramniotica (febbre + leucocitosi + tachicardia fetale): RIMOZIONE del cerchiaggio + antibiotici per IUI + espletamento" });
      results.alerts.push({ type: "info", text: "Se infezione vaginale semplice (BV, Candida) senza segni IUI: trattare, confermare negativizzazione, mantenere cerchiaggio" });
      results.alerts.push({ type: "info", text: "Documentare sempre nella cartella: germe isolato, antibiogramma, terapia somministrata, comunicazione con centro di riferimento" });
      results.monitoraggio.push("Tampone CV di controllo 1-2 settimane dopo trattamento", "Cervicometria seriata", "Emocromo + PCR settimanali se infezione recente");
    }

    if (temperatura >= 38 || (wbc && wbc > 15000) || (crp && crp > 20)) {
      results.alerts.push({ type: "danger", text: "Segni di infezione sistemica presenti → ESCLUDERE corioamnionite. Se confermata: antibiotici per IUI + espletamento (vedi scenario Corioamnionite)" });
    }
    results.fonti.push("ACOG PB #142 Cerclage 2014", "Donders Eur J Obstet 2020", "Fetal Med Barcelona Protocol 2024", "ScienceDirect Recurrent Infections Cerclage 2025", "Xiao Front Cell Infect Microbiol 2023");
    return results;
  }

  // ═══ COLICA RENALE / PIELECTASIA / LITIASI ═══
  if (scenario === "colicaRenale") {
    const dc = doloreColica;
    const haUrocolturaCR = urocoltura && urocoltura !== "" && urocoltura !== "negativa" && urocoltura !== "in_attesa";
    const haABGcr = uroABG && Object.keys(uroABG).length > 0;
    const haFebbre = temperatura >= 38;

    // ═══ GESTIONE UROLOGICA (analgesica/ostruttiva) ═══
    if (dc === "pielectasia") {
      results.diagnosi.push({ label: "Pielectasia isolata", severity: "info",
        detail: "La pielectasia destra è FISIOLOGICA in gravidanza (fino al 90% nel III trimestre). Non richiede trattamento di per sé" });
      if (!haUrocolturaCR && !haFebbre) {
        results.protocollo.push({ label: "🔧 Gestione urologica — nessun trattamento necessario", items: [
          { drug: "Nessun antibiotico", dose: "—", notes: "Pielectasia fisiologica destra per compressione dell'uretere da parte dell'utero gravido e progesterone" },
        ]});
      }
      results.alerts.push({ type: "info", text: "Se pielectasia SINISTRA o severa bilaterale → sospettare causa ostruttiva, non fisiologica. Approfondire con ecografia + eventuale RM senza gadolinio" });

    } else if (dc === "colica_semplice") {
      results.diagnosi.push({ label: "Colica renale" + (haUrocolturaCR ? " con IVU sovrapposta" : " senza segni di infezione"), severity: haUrocolturaCR ? "danger" : "warning",
        detail: "Litiasi renale in gravidanza: 1/200-1/1500. L'80% dei calcoli passa spontaneamente" });
      results.protocollo.push({ label: "🔧 Gestione urologica — terapia analgesica", items: [
        { drug: "Paracetamolo (Tachipirina®)", dose: "1g per os/IV ogni 6-8 ore", notes: "1ª scelta analgesica in gravidanza. Sicuro tutti i trimestri" },
        { drug: "Tramadolo (Contramal®)", dose: "50-100mg per os/IV ogni 6h se necessario", notes: "2ª linea. Evitare uso prolungato" },
      ]});
      results.alerts.push({ type: "danger", text: "FANS (Ketorolac, Diclofenac): CONTROINDICATI dopo 32 settimane (chiusura prematura dotto arterioso). Prima di 32s: uso breve possibile (max 48h)" });
      results.alerts.push({ type: "info", text: "Idratazione EV. Alfa-bloccante (tamsulosina 0,4mg/die) off-label per favorire espulsione — dati limitati in gravidanza" });
      if (!haUrocolturaCR) {
        results.alerts.push({ type: "warning", text: "Antibiotici: NON indicati se no febbre + urinocoltura negativa/sterile. Richiedere SEMPRE urinocoltura" });
      }
      results.monitoraggio.push("Ecografia renale per grado idronefrosi e dimensione calcolo", "Monitoraggio CTG se >24 settimane");

    } else if (dc === "colica_febbre" || dc === "pionefrosi") {
      const isPionefrosi = dc === "pionefrosi";
      results.diagnosi.push({ label: isPionefrosi ? "PIONEFROSI — EMERGENZA UROLOGICA" : "Colica renale + infezione (pielonefrite ostruttiva)",
        severity: "danger", detail: isPionefrosi
          ? "Raccolta purulenta in sistema escretore ostruito — rischio sepsi. Drenaggio + antibiotici"
          : "L'ostruzione e l'infezione si potenziano a vicenda: l'ostruzione favorisce la stasi e la proliferazione batterica; l'infezione aumenta l'edema e peggiora l'ostruzione" });

      // Analgesici comunque
      results.protocollo.push({ label: "🔧 Gestione urologica — analgesici + drenaggio se necessario", items: [
        { drug: "Paracetamolo ± Tramadolo", dose: "Come colica semplice", notes: "Analgesici anche in presenza di infezione" },
        ...(isPionefrosi ? [{ drug: "Drenaggio URGENTE", dose: "Stent JJ o nefrostomia percutanea", notes: "L'antibiotico SENZA drenaggio è INSUFFICIENTE nella pionefrosi" }] : []),
      ]});

      // Antibiotici IV empirici (se no antibiogramma)
      if (!haABGcr || !haUrocolturaCR) {
        if (!allergiaBetalatt) {
          results.protocollo.push({ label: "💊 Gestione infettivologica — antibiotici IV empirici (in attesa ABG)", items: [
            { drug: "Ceftriaxone (Rocefin®)", dose: isPionefrosi ? "2g IV ogni 24 ore" : "1-2g IV ogni 24 ore", notes: "1ª scelta pielonefrite. Guidare con ABG appena disponibile" },
          ]});
          if (isPionefrosi) {
            results.protocollo[results.protocollo.length-1].items.push(
              { drug: "Alternativa: Tazocin® (pip-tazo)", dose: "4,5g IV ogni 6 ore", notes: "Se sepsi o mancata risposta a cefalosporine" }
            );
          }
        } else {
          results.protocollo.push({ label: "💊 Gestione infettivologica — allergia β-latt", items: [
            { drug: "Aztreonam (Azactam®)", dose: "1g IV ogni 8h" + (!allergiaAmino ? " + Gentalyn® 5mg/kg IV ogni 24h" : ""), notes: "Consulenza infettivologica raccomandata" },
          ]});
        }
      }
      if (isPionefrosi) {
        results.monitoraggio.push("Consulenza urologica URGENTE per drenaggio", "Emocromo + PCR + procalcitonina + emocolture × 2 set");
      }
      results.alerts.push({ type: "warning", text: "Durata: IV fino apiressia 48-72h → step-down orale guidata da antibiogramma → totale 14-21 giorni" });
      results.monitoraggio.push("Ecografia renale per valutare idronefrosi e risposta", "Urinocoltura di controllo");

    } else if (dc === "litiasi_ostruttiva") {
      results.diagnosi.push({ label: "Litiasi ostruttiva documentata" + (haUrocolturaCR ? " + IVU sovrapposta" : ""), severity: haUrocolturaCR ? "danger" : "warning",
        detail: "Calcolo ostruttivo con idronefrosi — gestione conservativa iniziale, intervento se complicanze" });
      results.protocollo.push({ label: "🔧 Gestione urologica", items: [
        { drug: "Analgesici (Paracetamolo ± Tramadolo)", dose: "Come colica semplice", notes: "L'80% passa spontaneamente" },
      ]});
      results.alerts.push({ type: "warning", text: "Se febbre sovrapposta → ricovero + antibiotici come pielonefrite complicata + valutazione urologica per stent JJ" });
      results.alerts.push({ type: "info", text: "Se mancata espulsione + idronefrosi progressiva + dolore refrattario: stent JJ o nefrostomia percutanea (EAU 2025)" });
      results.alerts.push({ type: "info", text: "TC senza mdc CONTROINDICATA. RM senza gadolinio: gold standard per imaging litiasi in gravidanza" });
      results.monitoraggio.push("Ecografia renale seriata (ogni 1-2 settimane)", "Urinocoltura + esame urine (sorveglianza infezione)");
    } else {
      results.diagnosi.push({ label: "Selezionare il quadro clinico", severity: "info", detail: "Scegliere tra pielectasia, colica, pionefrosi, litiasi ostruttiva" });
    }

    // ═══ GESTIONE INFETTIVOLOGICA INTEGRATA (per TUTTI i sotto-scenari) ═══
    // Se urinocoltura positiva → aggiungere antibiotici guidati da ABG, INDIPENDENTEMENTE dal tipo di colica
    if (haUrocolturaCR) {
      results.diagnosi.push({ label: `IVU sovrapposta: ${urocoltura}`, severity: "warning",
        detail: "Infezione urinaria e patologia ostruttiva/dilatativa si potenziano a vicenda. L'infezione può essere causa, conseguenza o coincidente con la colica. Trattare SEMPRE l'infezione indipendentemente dalla causa della colica" });

      if (haABGcr) {
        // Antibiogramma-guided therapy (stessa logica IVU)
        const sensibiliCR = [];
        const isFebbreCR = haFebbre || dc === "colica_febbre" || dc === "pionefrosi";

        if (!isFebbreCR) {
          // IVU bassa sovrapposta → orale
          if (uroABG.fosfomicina === "S") sensibiliCR.push({ drug: "Fosfomicina (Monuril®)", dose: "3g per os singola", duration: "dose unica", notes: "Solo IVU basse senza febbre" });
          if (uroABG.cefalexina === "S") sensibiliCR.push({ drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6h", duration: "7 giorni", notes: "Sicura tutti i trimestri" });
          if (uroABG.amoxicillina === "S") sensibiliCR.push({ drug: "Amoxicillina (Zimox®)", dose: "500mg per os ogni 8h", duration: "7 giorni", notes: "Solo con ABG" });
          if (uroABG.amoxclav === "S") {
            const amNote = eg < 34 ? "⚠ <34s: preferire alternative se disponibili (rischio teorico NEC se parto imminente)" : eg < 37 ? "Non 1ª scelta in pretermine se alternative sensibili" : "OK a termine";
            sensibiliCR.push({ drug: "Amox-clav (Augmentin®)", dose: "875/125mg per os ogni 12h", duration: "7 giorni", notes: amNote });
          }
          if (uroABG.nitrofurantoina === "S" && eg < 36) sensibiliCR.push({ drug: "Nitrofurantoina (Neofuradantin®)", dose: "100mg per os ogni 12h", duration: "7 giorni", notes: "Solo IVU basse. STOP ≥36s. NO se pielectasia severa (dubbia penetrazione)" });
          if (uroABG.tmpsmx === "S" && trimestre === 2) sensibiliCR.push({ drug: "TMP-SMX (Bactrim®)", dose: "160/800mg per os ogni 12h", duration: "7 giorni", notes: "Solo II trimestre. Acido folico 4mg/die" });
        } else {
          // Pielonefrite / infezione alta → IV (step-down guidata da ABG)
          if (uroABG.ceftriaxone === "S") sensibiliCR.push({ drug: "Ceftriaxone (Rocefin®)", dose: "1-2g IV ogni 24h", duration: "IV→OS, totale 14gg", notes: "1ª scelta pielo" });
          if (uroABG.gentamicina === "S") sensibiliCR.push({ drug: "Gentalyn® (gentamicina)", dose: "5mg/kg IV ogni 24h", duration: "IV→OS, totale 14gg", notes: "Con TDM. NON in monoterapia per pionefrosi/sepsi — associare ad altro agente" });
          // ESBL+ o multi-R → escalation
          const isESBL = uroABG.esbl || (uroABG.ceftriaxone === "R" && uroABG.amoxclav === "R");
          if (isESBL || (uroABG.ceftriaxone === "R" && uroABG.gentamicina === "R")) {
            results.alerts.push({ type: "danger", text: `${urocoltura} multi-resistente${isESBL ? " (ESBL+)" : ""}. Consulenza infettivologica URGENTE. Opzioni: Ertapenem (Invanz®) 1g IV/die (1ª scelta ESBL+ — IDSA cUTI GL 2025), Meropenem 1g IV/8h se sepsi/pionefrosi. Se allergia β-latt: Aztreonam 1g IV/8-12h ± Gentalyn® (consulenza infettivologica)` });
          }
          if (dc === "pionefrosi" && sensibiliCR.length === 1 && sensibiliCR[0].drug.includes("Gentalyn")) {
            results.alerts.push({ type: "danger", text: "⚠ Gentamicina in MONOTERAPIA per pionefrosi è INSUFFICIENTE. La pionefrosi richiede copertura ad ampio spettro: aggiungere almeno un β-lattamico (ertapenem se ESBL+) o aztreonam se allergia. Consulenza infettivologica OBBLIGATORIA" });
          }
          // Step-down options
          results.alerts.push({ type: "info", text: `Step-down orale dopo apiressia: scegliere tra le molecole orali sensibili all'ABG di ${urocoltura}` });
        }

        if (sensibiliCR.length > 0) {
          results.protocollo.push({ label: `💊 Gestione infettivologica — terapia mirata per ${urocoltura} (ABG)`, items: sensibiliCR.map(s => ({
            drug: s.drug, dose: s.dose + (s.duration !== "dose unica" && s.duration ? ` × ${s.duration}` : ""), notes: s.notes
          })) });
        }
      } else {
        // No ABG — empirica
        if (dc !== "colica_febbre" && dc !== "pionefrosi") {
          // Solo colica semplice/pielectasia con urocoltura positiva ma senza ABG
          results.protocollo.push({ label: "💊 Gestione infettivologica — empirica (ABG in attesa)", items: [
            { drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6h × 7gg", notes: "In attesa ABG. Guidare appena disponibile" },
          ]});
        }
      }
      results.monitoraggio.push("Urinocoltura di controllo 1-2 settimane post-terapia");
    } else if (urocoltura === "in_attesa") {
      results.alerts.push({ type: "warning", text: "Urinocoltura in attesa — NON iniziare antibiotici empirici se paziente apiretica e stabile. Se febbre: iniziare ceftriaxone IV empirico" });
    } else if (!urocoltura) {
      results.alerts.push({ type: "warning", text: "Urinocoltura NON ESEGUITA — richiedere SEMPRE in qualsiasi quadro urologico in gravidanza (ACOG CC No.4 2023)" });
    }

    results.fonti.push("EAU Urological Infections GL 2025", "EAU Urolithiasis GL 2025", "ACOG CC No.4 UTI 2023", "ACOG/SMFM 2019");
    return results;
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

const SCENARIOS_INPUT = [
  { id: "ivu", label: "Infezione delle Vie Urinarie", icon: "🔬" },
  { id: "cervicovaginale", label: "Infezione Cervicovaginale", icon: "🔎" },
  { id: "pprom", label: "pPROM (latenza + travaglio)", icon: "💧" },
  { id: "promTermine", label: "PROM a Termine", icon: "⏰" },
  { id: "travaglio", label: "Travaglio / IAP GBS", icon: "🛡️" },
  { id: "incompCervicale", label: "Incompetenza Cervicale / Sacco in Vagina", icon: "🔓" },
  { id: "colicaRenale", label: "Colica Renale / Pielectasia / Litiasi", icon: "💎" },
];

// ═══════════════════════════════════════════════════════════════
// SMART CLINICAL SEARCH — keyword matching engine
// ═══════════════════════════════════════════════════════════════

function parseSmartQuery(query) {
  const q = query.toLowerCase().replace(/[''`]/g, "'").replace(/[""]/g, '"').trim();
  const tokens = q.split(/[\s,;./]+/).filter(Boolean);
  const result = { scenarios: [], fields: {}, interpreted: [] };

  // ═══ HELPER: check if any keyword matches ═══
  const has = (...words) => words.some(w => q.includes(w));
  const hasToken = (...words) => tokens.some(t => words.some(w => t === w || t.startsWith(w)));

  // ═══ 1. SCENARI ═══

  // IVU
  if (has("ivu", "cistite", "pielonefrite", "pielo", "urinari", "urinocoltura", "infezione urin", "vie urinarie") || (has("batteriuria") && !has("batteriuria gbs", "gbs"))) {
    result.scenarios.push("ivu");
    if (has("pielo", "pielonefrite")) {
      result.fields.sintomiUrinari = "pielo";
      result.interpreted.push("🔬 IVU — pielonefrite");
    } else if (has("batteriuria asintomatica", "ba ")) {
      result.fields.sintomiUrinari = null;
      result.interpreted.push("🔬 Batteriuria asintomatica");
    } else {
      result.fields.sintomiUrinari = "si";
      result.interpreted.push("🔬 IVU — cistite");
    }
  }

  // Cervicovaginale
  if (has("vaginale", "vaginite", "vaginosi", "candida", "candidosi", "cervicite", "cervicovaginale", "tampone cv", "bv ", "trichomonas", "chlamydia", "clamidia", "gonorrea", "ureaplasma", "mycoplasma", "m. hominis")) {
    result.scenarios.push("cervicovaginale");
    result.fields.sintomiVaginali = "si";
    result.interpreted.push("🔎 Infezione cervicovaginale");
    // Patogeni specifici
    if (has("candida", "candidosi")) { result.fields.tamponeCVResult = "candida"; result.fields.tamponeDisponibile = "si"; result.interpreted.push("  → Candida"); }
    else if (has("vaginosi", "bv ")) { result.fields.tamponeCVResult = "bv"; result.fields.tamponeDisponibile = "si"; result.interpreted.push("  → Vaginosi batterica"); }
    else if (has("chlamydia", "clamidia")) { result.fields.tamponeCVResult = "chlamydia"; result.fields.tamponeDisponibile = "si"; result.interpreted.push("  → Chlamydia"); }
    else if (has("gonorrea")) { result.fields.tamponeCVResult = "gonorrea"; result.fields.tamponeDisponibile = "si"; result.interpreted.push("  → Gonorrea"); }
    else if (has("trichomonas")) { result.fields.tamponeCVResult = "trichomonas"; result.fields.tamponeDisponibile = "si"; result.interpreted.push("  → Trichomonas"); }
    else if (has("ureaplasma")) { result.fields.tamponeCVResult = "ureaplasma"; result.fields.tamponeDisponibile = "si"; result.interpreted.push("  → Ureaplasma"); }
    else if (has("m. hominis", "mycoplasma hominis", "m hominis")) { result.fields.tamponeCVResult = "m_hominis"; result.fields.tamponeDisponibile = "si"; result.interpreted.push("  → M. hominis"); }
  }

  // pPROM
  if (has("pprom", "p-prom", "rottura pretermine", "rottura prematura preterm", "latenza")) {
    result.scenarios.push("pprom");
    result.fields.membraneStatus = "rotte_pretermine";
    result.interpreted.push("💧 pPROM");
  }

  // PROM a termine — deve distinguere da pPROM
  if ((has("prom", "rottura membrane", "rottura delle membrane", "membrane rotte") && !has("pprom", "pretermine", "preterm", "latenza"))) {
    // Check se è a termine o pretermine via EG
    const egMatch = q.match(/(\d{2}[.,]?\d?)\s*(?:sett|s\b|w\b|settim|\+)/);
    const eg = egMatch ? parseFloat(egMatch[1].replace(",", ".")) : null;
    if (eg && eg < 37) {
      result.scenarios.push("pprom");
      result.fields.membraneStatus = "rotte_pretermine";
      result.interpreted.push("💧 pPROM (EG < 37s)");
    } else {
      result.scenarios.push("promTermine");
      result.fields.membraneStatus = "rotte_termine";
      result.interpreted.push("⏰ PROM a termine");
    }
  }

  // Travaglio
  if (has("travaglio", "in travaglio", "contrazioni", "iap ", "profilassi gbs", "profilassi intrapartum")) {
    result.scenarios.push("travaglio");
    result.interpreted.push("🛡️ Travaglio / IAP GBS");
  }

  // Incompetenza cervicale
  if (has("incompetenza cervicale", "sacco in vagina", "sacco vagina", "cerchiaggio", "cervice corta", "prolasso membrane", "dilatazione cervicale", "cervical insufficiency")) {
    result.scenarios.push("incompCervicale");
    result.interpreted.push("🔓 Incompetenza cervicale");
    if (has("sacco in vagina", "sacco vagina", "prolasso membrane")) {
      result.fields.sottoscenarioIC = "sacco_vagina";
      result.fields.saccoInVagina = true;
      result.interpreted.push("  → Sacco in vagina");
    }
    if (has("cerchiaggio")) { result.fields.cerchiaggio = true; result.interpreted.push("  → Cerchiaggio in situ"); }
  }

  // Colica renale
  if (has("colica renale", "colica", "pielectasia", "idronefrosi", "calcolo renale", "litiasi", "pionefrosi", "nefrostomia", "stent jj")) {
    result.scenarios.push("colicaRenale");
    result.interpreted.push("💎 Colica renale");
    if (has("pionefrosi")) { result.fields.doloreColica = "pionefrosi"; result.interpreted.push("  → Pionefrosi"); }
    else if (has("litiasi ostruttiva", "calcolo ostruttivo")) { result.fields.doloreColica = "litiasi_ostruttiva"; }
    else if (has("pielectasia")) { result.fields.doloreColica = "pielectasia"; }
    else { result.fields.doloreColica = "colica_semplice"; }
  }

  // Corioamnionite (indirizza a travaglio con febbre)
  if (has("corioamnionite", "iui", "infezione intrauterina", "intra-amniotica")) {
    if (!result.scenarios.includes("travaglio")) result.scenarios.push("travaglio");
    result.interpreted.push("🔥 Sospetta corioamnionite");
    if (!result.fields.temperatura) result.fields.temperatura = 38.5;
    if (!result.fields.wbc) result.fields.wbc = 20000;
  }

  // Endometrite / post-partum / mastite / ferita — protocollo cards, non generatore
  if (has("endometrite", "post-partum", "post partum", "mastite", "ferita", "infezione ferita")) {
    result.interpreted.push("📋 Per endometrite/mastite/ferita: consulta i 'Protocolli per Scenario'");
  }

  // TC elettivo
  if (has("tc elettivo", "cesareo elettivo", "taglio cesareo elettivo", "cesareo programmato")) {
    if (!result.scenarios.includes("travaglio")) result.scenarios.push("travaglio");
    result.fields.tcElettivoMI = true;
    result.interpreted.push("🔪 TC elettivo membrane integre → NO IAP, solo profilassi TC");
  }

  // ═══ 2. EPOCA GESTAZIONALE ═══
  const egPatterns = [
    /(\d{2})[.,](\d)\s*(?:sett|s\b|w\b|settim|\+)/i,
    /(\d{2})\s*(?:sett|settim|w\b)/i,
    /(?:eg|epoca|gestaz)[:\s]*(\d{2})[.,]?(\d)?/i,
    /(\d{2})\+(\d)/,
    /a\s+(\d{2})\s*(?:sett|s\b)/i,
  ];
  for (const pat of egPatterns) {
    const m = q.match(pat);
    if (m) {
      const major = parseInt(m[1]);
      const minor = m[2] ? parseInt(m[2]) : 0;
      const eg = major + (minor > 0 && minor < 10 ? minor / (m[0].includes("+") ? 7 : 10) : 0);
      if (eg >= 4 && eg <= 42) {
        result.fields.eg = Math.round(eg * 10) / 10;
        result.interpreted.push(`📅 EG: ${result.fields.eg} settimane`);
        // Auto-resolve PROM type by EG
        if (result.fields.eg < 37 && result.scenarios.includes("promTermine")) {
          result.scenarios = result.scenarios.filter(s => s !== "promTermine");
          if (!result.scenarios.includes("pprom")) result.scenarios.push("pprom");
          result.fields.membraneStatus = "rotte_pretermine";
          result.interpreted.push("  → EG < 37 → convertito in pPROM");
        }
        break;
      }
    }
  }

  // ═══ 3. ALLERGIE ═══
  if (has("allergia penicillin", "allergica penicillin", "allergica a penicillin", "allergia beta-latt", "allergia β-latt", "allergia betalatt")) {
    if (has("alto rischio", "anafilassi", "angioedema", "alto")) {
      result.fields.allergie = { stato: "presente", penicilline: "alto" };
      result.interpreted.push("⚠ Allergia penicilline — ALTO rischio (anafilassi)");
    } else {
      result.fields.allergie = { stato: "presente", penicilline: "basso" };
      result.interpreted.push("⚠ Allergia penicilline — basso rischio (rash)");
    }
  }
  if (has("allergia macrolid", "allergica macrolid", "allergia azitromicina", "allergia eritromicina")) {
    const all = result.fields.allergie || { stato: "presente" };
    all.stato = "presente"; all.macrolidi = true;
    result.fields.allergie = all;
    result.interpreted.push("⚠ Allergia macrolidi");
  }
  if (has("nessuna allergia", "no allergia", "no allergie", "non allergic")) {
    result.fields.allergie = { stato: "nessuna" };
    result.interpreted.push("✓ Nessuna allergia nota");
  }

  // ═══ 4. GBS ═══
  if (has("gbs positivo", "gbs +", "gbs+", "streptococco b positiv", "gbs pos")) {
    result.fields.gbsStatus = "positivo";
    result.interpreted.push("🦠 GBS positivo");
  } else if (has("gbs negativo", "gbs neg", "gbs -", "gbs−")) {
    result.fields.gbsStatus = "negativo";
    result.interpreted.push("🦠 GBS negativo");
  } else if (has("gbs ignoto", "gbs non eseguito", "gbs sconosciuto", "gbs non disponibile", "tampone non eseguito", "senza tampone gbs")) {
    result.fields.gbsStatus = "ignoto";
    result.interpreted.push("🦠 GBS ignoto / non eseguito");
  }

  // ═══ 5. TEMPERATURA / FEBBRE ═══
  const tempMatch = q.match(/(?:t|temp|temperatura|febbre)[:\s]*(\d{2}[.,]?\d?)\s*°?/i) || q.match(/(\d{2}[.,]?\d?)\s*°?\s*(?:di febbre|di temperatura|febbre)/i);
  if (tempMatch) {
    result.fields.temperatura = parseFloat(tempMatch[1].replace(",", "."));
    result.interpreted.push(`🌡️ Temperatura: ${result.fields.temperatura}°C`);
  } else if (has("febbre", "febbrile", "iperpiressia") && !result.fields.temperatura) {
    result.fields.temperatura = 38.5;
    result.interpreted.push("🌡️ Febbre (impostata 38.5°C — modificare se diverso)");
  } else if (has("apirettica", "apiretica", "no febbre", "senza febbre") && !result.fields.temperatura) {
    result.fields.temperatura = 37;
    result.interpreted.push("🌡️ Apirettica");
  }

  // ═══ 6. WBC ═══
  const wbcMatch = q.match(/(?:wbc|bianchi|leucocit|gb)[:\s]*(\d{3,6})/i) || q.match(/(\d{4,6})\s*(?:wbc|bianchi|leucocit)/i);
  if (wbcMatch) {
    result.fields.wbc = parseInt(wbcMatch[1]);
    result.interpreted.push(`🩸 WBC: ${result.fields.wbc.toLocaleString()}`);
  }

  // ═══ 7. PCR ═══
  const crpMatch = q.match(/(?:pcr|crp|proteina c)[:\s]*(\d+[.,]?\d*)/i);
  if (crpMatch) {
    result.fields.crp = parseFloat(crpMatch[1].replace(",", "."));
    result.interpreted.push(`🩸 PCR: ${result.fields.crp} mg/L`);
  }

  // ═══ 8. ORE ROTTURA ═══
  const rotMatch = q.match(/(?:rottura|rotte?)\s*(?:da|di)?\s*(\d+[.,]?\d*)\s*(?:h|ore|hr)/i) || q.match(/(\d+[.,]?\d*)\s*(?:h|ore)\s*(?:dalla|di)?\s*rottura/i);
  if (rotMatch) {
    result.fields.oreRottura = parseFloat(rotMatch[1].replace(",", "."));
    result.interpreted.push(`⏱️ Rottura da ${result.fields.oreRottura}h`);
  }

  // ═══ 9. PESO ═══
  const pesoMatch = q.match(/(?:peso|kg)[:\s]*(\d{2,3})/i) || q.match(/(\d{2,3})\s*kg/i);
  if (pesoMatch) {
    const p = parseInt(pesoMatch[1]);
    if (p >= 40 && p <= 200) {
      result.fields.pesoKg = p;
      result.interpreted.push(`⚖️ Peso: ${p} kg`);
    }
  }

  // ═══ 10. FLAGS ═══
  if (has("g6pd", "favismo")) { result.fields.g6pd = true; result.interpreted.push("🧬 G6PD / Favismo"); }
  if (has("precedente neonato gbs", "neonato gbs", "precedente gbs neonatale")) { result.fields.precedenteNeonatoGBS = true; result.interpreted.push("👶 Precedente neonato con malattia GBS"); }
  if (has("batteriuria gbs", "gbs nelle urine", "gbs urine")) { result.fields.batteriuriaGBS = true; result.interpreted.push("🧫 Batteriuria GBS"); }
  if (has("membrane integre", "membrane intatte")) { result.fields.membraneStatus = "integre"; result.interpreted.push("🫧 Membrane integre"); }
  if (has("tachicardia fetale", "tachi fetale", "fcf >160", "fcf elevata")) { result.fields.fcFetale = 175; result.interpreted.push("💓 Tachicardia fetale"); }
  if (has("pretermine", "preterm") && !result.fields.eg) { result.fields.eg = 33; result.interpreted.push("📅 Pretermine (EG impostata 33s — modificare)"); }
  if (has("a termine", "termine") && !result.fields.eg && !has("pretermine")) { result.fields.eg = 39; result.interpreted.push("📅 A termine (EG impostata 39s — modificare)"); }
  if (has("primipara", "primigravida", "nullipara")) { result.interpreted.push("ℹ️ Primipara (informazione registrata)"); }
  if (has("esbl", "multi-resist", "multiresist", "mdr")) { result.interpreted.push("⚠ Germe multiresistente — inserire antibiogramma manualmente"); }

  // ═══ 11. pPROM FASE ═══
  if (result.scenarios.includes("pprom")) {
    if (has("esordio travaglio", "appena in travaglio", "travaglio esordio")) {
      result.fields.fasePprom = "travaglio_esordio";
      result.interpreted.push("  → pPROM: esordio travaglio");
    } else if (has("conservativa", "gestione conservativa", "aspettativa")) {
      result.fields.fasePprom = "conservativa";
      result.interpreted.push("  → pPROM: gestione conservativa");
    }
    if (has("travaglio") && !has("esordio")) {
      if (!result.scenarios.includes("travaglio")) result.scenarios.push("travaglio");
    }
  }

  // Deduplicate scenarios
  result.scenarios = [...new Set(result.scenarios)];

  return result;
}

const PATHOGENS = [
  { id: "candida", label: "Candida spp." }, { id: "bv", label: "Vaginosi Batterica" },
  { id: "chlamydia", label: "Chlamydia" }, { id: "gonorrea", label: "Gonorrea" },
  { id: "trichomonas", label: "Trichomonas" }, { id: "m_hominis", label: "M. hominis" },
  { id: "ureaplasma", label: "Ureaplasma" },
];

function InputField({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1A3C5E", marginBottom: 3 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: "#95A5A6", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value || null)}
      style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #D5DBDB", borderRadius: 6, fontSize: 13, background: "white", color: "#2C3E50" }}>
      <option value="">{placeholder || "— Seleziona —"}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function NumberInput({ value, onChange, placeholder, min, max, step }) {
  return (
    <input type="number" value={value ?? ""} onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
      placeholder={placeholder} min={min} max={max} step={step || 1}
      style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #D5DBDB", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
  );
}

function ABGInput({ label, value, onChange }) {
  const drugs = ["amoxicillina", "amoxclav", "cefalexina", "ceftriaxone", "nitrofurantoina", "fosfomicina", "gentamicina", "tmpsmx"];
  const drugLabels = { amoxicillina: "Amoxicillina", amoxclav: "Amox-clav", cefalexina: "Cefalexina", ceftriaxone: "Ceftriaxone", nitrofurantoina: "Nitrofurant.", fosfomicina: "Fosfomicina", gentamicina: "Gentamicina", tmpsmx: "TMP-SMX" };
  const abg = value || {};
  return (
    <div style={{ background: "#F8F9FA", borderRadius: 6, padding: 8, marginTop: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#1A3C5E", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {drugs.map(d => (
          <div key={d} style={{ fontSize: 10, textAlign: "center" }}>
            <div style={{ marginBottom: 2, color: "#5D6D7E" }}>{drugLabels[d]}</div>
            <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
              {["S", "I", "R"].map(s => (
                <button key={s} onClick={() => onChange({ ...abg, [d]: abg[d] === s ? null : s })}
                  style={{ width: 22, height: 22, border: "1px solid #BDC3C7", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
                    background: abg[d] === s ? (s === "S" ? "#27AE60" : s === "R" ? "#C0392B" : "#F39C12") : "white",
                    color: abg[d] === s ? "white" : "#7F8C8D" }}>{s}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <label style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 3 }}>
          <input type="checkbox" checked={abg.esbl || false} onChange={e => onChange({ ...abg, esbl: e.target.checked })} /> ESBL+
        </label>
      </div>
    </div>
  );
}

function CVSwabInput({ label, value, onChange }) {
  const drugs = ["clindamicina", "azitromicina", "metronidazolo", "ceftriaxone"];
  const abg = value || {};
  return (
    <div style={{ background: "#F8F9FA", borderRadius: 6, padding: 8, marginTop: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#1A3C5E", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {drugs.map(d => (
          <div key={d} style={{ fontSize: 10, textAlign: "center" }}>
            <div style={{ marginBottom: 2, color: "#5D6D7E" }}>{d.charAt(0).toUpperCase() + d.slice(1)}</div>
            <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
              {["S", "I", "R"].map(s => (
                <button key={s} onClick={() => onChange({ ...abg, [d]: abg[d] === s ? null : s })}
                  style={{ width: 22, height: 22, border: "1px solid #BDC3C7", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
                    background: abg[d] === s ? (s === "S" ? "#27AE60" : s === "R" ? "#C0392B" : "#F39C12") : "white",
                    color: abg[d] === s ? "white" : "#7F8C8D" }}>{s}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultView({ results, patientData, user }) {
  if (!results || (!results.diagnosi.length && !results.protocollo.length)) return null;

  const handlePrint = () => {
    window.print();
  };

  // Build patient summary for print header
  const pd = patientData || {};
  const scenarioLabels = (pd.scenarios || []).map(id => {
    const found = SCENARIOS_INPUT.find(s => s.id === id);
    return found ? found.label : id;
  });
  const allergyText = pd.allergie?.penicilline === "alto" ? "Allergia β-latt ALTO rischio"
    : pd.allergie?.penicilline === "basso" ? "Allergia β-latt basso rischio"
    : pd.allergie?.macrolidi ? "Allergia macrolidi" : "Nessuna allergia nota";
  const gbsText = pd.gbsStatus === "positivo" ? "GBS +" : pd.gbsStatus === "negativo" ? "GBS −" : "GBS ignoto";
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2,"0")}/${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  return (
    <div className="protocol-result" style={{ marginTop: 12 }}>
      {/* ═══ @MEDIA PRINT STYLES ═══ */}
      <style>{`
        @media print {
          /* Hide everything except the protocol result */
          body > * { visibility: hidden !important; }
          .protocol-result, .protocol-result * { visibility: visible !important; }
          .protocol-result { position: absolute; left: 0; top: 0; width: 100%; padding: 0 20px; }

          /* Show print-only header */
          .print-header { display: block !important; }
          .print-footer { display: block !important; }

          /* Hide print button and screen-only elements */
          .no-print, button.no-print { display: none !important; }

          /* Clean backgrounds for paper */
          .protocol-result { background: white !important; color: black !important; }
          .protocol-result div { box-shadow: none !important; }

          /* Keep colored left borders for severity but lighten backgrounds */
          .diag-card { background: #f9f9f9 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .alert-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

          /* Typography */
          .protocol-result { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.45; }
          .protocol-result .section-title { font-size: 13pt; color: #1A3C5E; border-color: #1A3C5E; }
          .protocol-result .drug-name { font-size: 11pt; }
          .protocol-result .drug-dose { font-size: 10.5pt; }
          .protocol-result .drug-note { font-size: 9pt; color: #555; }
          .protocol-result .fonti-text { font-size: 8pt; }

          /* Page setup */
          @page { margin: 15mm 12mm; size: A4; }

          /* Avoid breaking inside cards */
          .proto-card, .diag-card, .alert-card { break-inside: avoid; page-break-inside: avoid; }
        }

        /* Hide print elements on screen */
        @media screen {
          .print-header { display: none; }
          .print-footer { display: none; }
        }
      `}</style>

      {/* ═══ PRINT-ONLY HEADER ═══ */}
      <div className="print-header" style={{ marginBottom: 20, paddingBottom: 14, borderBottom: "2.5px solid #1A3C5E" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "16pt", fontWeight: 800, color: "#1A3C5E", letterSpacing: 0.5 }}>PROTOCOLLO OSTETRICO</div>
            <div style={{ fontSize: "10pt", color: "#555", marginTop: 2 }}>Clinica Ostetrico-Ginecologica — DIM — University of Bari "Aldo Moro"</div>
          </div>
          <div style={{ textAlign: "right", fontSize: "9pt", color: "#777" }}>
            <div>Generato: {dateStr}</div>
            <div>Dott. {user?.fullName || "—"}</div>
          </div>
        </div>
        <div style={{ marginTop: 10, padding: "8px 12px", background: "#f5f7f9", borderRadius: 4, fontSize: "9.5pt" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
            {pd.eg && <span><strong>EG:</strong> {pd.eg} settimane</span>}
            {pd.pesoKg && <span><strong>Peso:</strong> {pd.pesoKg} kg</span>}
            <span><strong>Allergie:</strong> {allergyText}</span>
            <span><strong>{gbsText}</strong></span>
            {pd.temperatura && pd.temperatura >= 37.5 && <span><strong>T:</strong> {pd.temperatura}°C</span>}
            {pd.wbc && pd.wbc > 15000 && <span><strong>WBC:</strong> {pd.wbc.toLocaleString()}</span>}
            {pd.crp && pd.crp > 5 && <span><strong>PCR:</strong> {pd.crp} mg/L</span>}
            {pd.oreRottura && <span><strong>Rottura:</strong> {pd.oreRottura}h</span>}
          </div>
          <div style={{ marginTop: 4, color: "#1A3C5E" }}><strong>Scenario:</strong> {scenarioLabels.join(" + ") || "—"}</div>
        </div>
      </div>

      {/* ═══ SCREEN TITLE + PRINT BUTTON ═══ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, borderBottom: "2px solid #0E7C6B", paddingBottom: 6 }}>
        <div className="section-title" style={{ fontSize: 16, fontWeight: 700, color: "#1A3C5E" }}>
          📋 PROTOCOLLO TERAPEUTICO PERSONALIZZATO
        </div>
        <button className="no-print" onClick={handlePrint}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "linear-gradient(135deg, #1A3C5E, #2C3E50)",
            color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", letterSpacing: 0.3,
            transition: "opacity 0.2s" }}
          onMouseEnter={e => e.target.style.opacity = "0.85"}
          onMouseLeave={e => e.target.style.opacity = "1"}>
          <span style={{ fontSize: 16 }}>🖨️</span> Stampa / PDF
        </button>
      </div>

      {/* ═══ DIAGNOSI ═══ */}
      {results.diagnosi.map((d, i) => (
        <div key={i} className="diag-card" style={{ background: d.severity === "danger" ? "#FDEDEC" : d.severity === "warning" ? "#FEF9E7" : "#EAF0F5",
          borderLeft: `4px solid ${d.severity === "danger" ? "#C0392B" : d.severity === "warning" ? "#F39C12" : "#2980B9"}`,
          padding: "8px 12px", borderRadius: 6, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: d.severity === "danger" ? "#C0392B" : d.severity === "warning" ? "#E67E22" : "#2980B9" }}>{d.label}</div>
          <div className="drug-note" style={{ fontSize: 12, color: "#5D6D7E" }}>{d.detail}</div>
        </div>
      ))}

      {/* ═══ PROTOCOLLO ═══ */}
      {results.protocollo.map((p, i) => (
        <div key={i} className="proto-card" style={{ background: "white", border: "1px solid #E0E0E0", borderRadius: 8, padding: "10px 14px", marginBottom: 10 }}>
          <div className="section-title" style={{ fontSize: 13, fontWeight: 700, color: "#0E7C6B", marginBottom: 6, borderBottom: "1px solid #E8F6F3", paddingBottom: 4 }}>{p.label}</div>
          {p.items.map((item, j) => (
            <div key={j} style={{ padding: "6px 0", borderBottom: j < p.items.length - 1 ? "1px dotted #ECF0F1" : "none" }}>
              <div className="drug-name" style={{ fontWeight: 600, color: "#1A3C5E", fontSize: 13 }}>{item.drug}</div>
              <div className="drug-dose" style={{ fontSize: 12, color: "#34495E" }}>{item.dose}</div>
              {item.notes && <div className="drug-note" style={{ fontSize: 11, color: "#7F8C8D", fontStyle: "italic" }}>{item.notes}</div>}
            </div>
          ))}
        </div>
      ))}

      {/* ═══ ALERTS ═══ */}
      {results.alerts.map((a, i) => {
        const styles = { danger: { bg: "#FDEDEC", border: "#C0392B", icon: "🚫" }, warning: { bg: "#FEF9E7", border: "#F39C12", icon: "⚠️" }, info: { bg: "#EAF0F5", border: "#2980B9", icon: "ℹ️" } };
        const s = styles[a.type] || styles.info;
        return (<div key={i} className="alert-card" style={{ background: s.bg, borderLeft: `4px solid ${s.border}`, padding: "7px 11px", marginBottom: 5, borderRadius: 4, fontSize: 12 }}>
          <span style={{ marginRight: 5 }}>{s.icon}</span>{a.text}
        </div>);
      })}

      {/* ═══ MONITORAGGIO ═══ */}
      {results.monitoraggio.length > 0 && (
        <div className="proto-card" style={{ background: "#F4F6F7", borderRadius: 8, padding: "10px 14px", marginTop: 8 }}>
          <div className="section-title" style={{ fontSize: 13, fontWeight: 700, color: "#1A3C5E", marginBottom: 4 }}>📊 Monitoraggio</div>
          {results.monitoraggio.map((m, i) => <div key={i} style={{ fontSize: 12, color: "#34495E", padding: "2px 0" }}>• {m}</div>)}
        </div>
      )}

      {/* ═══ FONTI ═══ */}
      {results.fonti.length > 0 && (
        <div className="fonti-text" style={{ fontSize: 10, color: "#95A5A6", marginTop: 10, fontStyle: "italic" }}>
          Fonti: {results.fonti.join(" · ")}
        </div>
      )}

      {/* ═══ PRINT-ONLY FOOTER ═══ */}
      <div className="print-footer" style={{ marginTop: 20, paddingTop: 10, borderTop: "1px solid #ccc", fontSize: "8pt", color: "#999" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Strumento di supporto decisionale — NON sostituisce il giudizio clinico</span>
          <span>Dott. {user?.fullName || "—"} · Clinica Ostetrica · Univ. Bari · {now.getFullYear()}</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// REFERENCE PAGES — Protocol Cards, Formulary, Safety Table
// ═══════════════════════════════════════════════════════════════

const PROTOCOL_CARDS = [
  { id: "ba_cistite", title: "Batteriuria Asintomatica / Cistite", icon: "🔬", rows: [
    { drug: "Fosfomicina (Monuril®)", dose: "3g per os", durata: "Dose unica", note: "1ª scelta empirica (AOGOI/SNLG). Solo IVU basse", fonte: "ACOG CC No.4 2023" },
    { drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6h", durata: "7 giorni", note: "1ª scelta ACOG. Sicura tutti i trimestri", fonte: "ACOG CC No.4 2023" },
    { drug: "Nitrofurantoina (Neofuradantin®)", dose: "100mg per os ogni 12h", durata: "7 giorni", note: "STOP a 36-38s. CI: G6PD", fonte: "ACOG CC No.4; NICE NG109" },
    { drug: "Amoxicillina (Zimox®)", dose: "500mg per os ogni 8h", durata: "7 giorni", note: "SOLO con antibiogramma — MAI empirica (R 20-40%)", fonte: "ACOG CC No.4 2023" },
    { drug: "Amox-clav (Augmentin®)", dose: "875/125mg per os ogni 12h", durata: "7 giorni", note: "CI nella pPROM. In pretermine <34s: preferire alternative (rischio teorico NEC se parto imminente). A termine: OK", fonte: "ACOG CC No.4 2023; ORACLE I" },
    { drug: "TMP-SMX (Bactrim®)", dose: "160/800mg per os ogni 12h", durata: "7 giorni", note: "SOLO II trim. Acido folico 4mg/die. CI I trim (NTD) e ≥36s (kernicterus)", fonte: "ACOG CC No.4 2023" },
  ], footer: "Durata 7gg (ACOG range 5-7gg — in gravidanza si preferisce il limite superiore). Test of cure: urinocoltura 1-2 sett post-terapia. BA: ISS/SNLG 2023 ha abolito lo screening in IT." },

  { id: "pielo", title: "Pielonefrite", icon: "🏥", rows: [
    { drug: "Ceftriaxone (Rocefin®)", dose: "1-2g IV ogni 24h", durata: "IV fino apiressia 48h → OS", note: "1ª scelta. Cautela peripartum", fonte: "ACOG CC No.4 2023" },
    { drug: "Amplital® + Gentalyn®", dose: "2g IV/6h + 5mg/kg IV/24h", durata: "IV fino apiressia 48h", note: "Alternativa. Genta: dose unica/die", fonte: "ACOG CC No.4 2023" },
    { drug: "Step-down orale", dose: "Keforal® 500mg/6h (o secondo ABG)", durata: "Totale 14 giorni", note: "Guidata da antibiogramma", fonte: "ACOG CC No.4 2023" },
    { drug: "Soppressiva post-pielo", dose: "Nitrofurantoina 100mg o Cefalexina 250mg sera", durata: "Resto della gravidanza", note: "Senza soppressiva: recidiva 25-60%", fonte: "ACOG CC No.4 2023" },
  ], footer: "OSPEDALIZZAZIONE OBBLIGATORIA. Se mancata risposta 48-72h → eco renale per escludere ostruzione. Fosfomicina/Nitrofurantoina: MAI per pielo (no penetrazione parenchimale)." },

  { id: "cv_bv", title: "Vaginosi Batterica (BV)", icon: "🦠", rows: [
    { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2v/die", durata: "7 giorni", note: "1ª scelta. Sicuro tutti i trimestri (Burtin 1995: OR 0,93)", fonte: "CDC STI GL 2021" },
    { drug: "Dalacin® crema vaginale 2%", dose: "5g intravag con applicatore", durata: "7 giorni", note: "Alternativa topica se intolleranza GI", fonte: "CDC STI GL 2021" },
    { drug: "Zidoval® (metro gel 0,75%)", dose: "5g intravag", durata: "5 giorni", note: "CDC 'Alternative Regimen'", fonte: "CDC STI GL 2021" },
    { drug: "Meclon® (metro+clotrimazolo)", dose: "1 ovulo intravag/die", durata: "6-10 giorni", note: "Se sospetto BV+Candida mista. NON nelle LG — pratica IT", fonte: "Pratica clinica IT" },
  ], footer: "Trattare SOLO se sintomatica (CDC 2021). Eccezione: in contesto di IC trattare SEMPRE (Donders 2020). Asintomatica in gravidanza: NON trattare di routine (Klebanoff NEJM 2001)." },

  { id: "cv_candida", title: "Candidosi Vulvovaginale", icon: "🍄", rows: [
    { drug: "Clotrimazolo (Canesten®) crema 1%", dose: "5g intravag", durata: "7 giorni", note: "1ª scelta CDC/ACOG", fonte: "CDC STI GL 2021" },
    { drug: "Miconazolo (Daktarin®) ovuli", dose: "100mg 1 ovulo intravag", durata: "7 giorni", note: "Alternativa topica", fonte: "CDC STI GL 2021; BASHH" },
    { drug: "Gynocanesten® cp vaginali", dose: "100mg 1 cp intravag/die", durata: "6 giorni", note: "Stesso PA del Canesten® crema", fonte: "AIFA" },
    { drug: "Mycostatin® (nistatina)", dose: "100.000 UI 1-2 cp intravag", durata: "14 giorni", note: "Per C. non-albicans resistente agli azolici", fonte: "CDC STI GL 2021" },
  ], footer: "Fluconazolo orale: CONTROINDICATO a qualsiasi dose (NEJM 2013 OR 3,16 ToF; CMAJ 2019 aOR 2,23). Cicli prolungati 7gg (non 3gg) in gravidanza." },

  { id: "cv_ct_ng", title: "Chlamydia / Gonorrea", icon: "🔴", rows: [
    { drug: "Azitromicina (Zitromax®)", dose: "1g per os", durata: "Dose singola", note: "1ª scelta CT (guarigione 96%)", fonte: "CDC STI GL 2021; ACOG" },
    { drug: "Amoxicillina (Zimox®)", dose: "500mg per os 3v/die", durata: "7 giorni", note: "Alternativa CT (CDC 2021)", fonte: "CDC STI GL 2021" },
    { drug: "Ceftriaxone (Rocefin®)", dose: "500mg IM (1g se ≥150kg)", durata: "Dose singola", note: "1ª scelta NG. + Zitromax® 1g se CT non esclusa", fonte: "CDC MMWR 2020; WHO 2016" },
  ], footer: "Trattare SEMPRE il partner. Test of cure: NAAT 4 settimane + retest 3 mesi. Doxiciclina CI in gravidanza (ACOG/CDC)." },

  { id: "pprom", title: "pPROM — Protocollo Latenza", icon: "💧", rows: [
    { drug: "Amplital® (ampicillina)", dose: "2g IV ogni 6h", durata: "48h (gg 1-2)", note: "Fase IV", fonte: "Mercer JAMA 1997; ACOG PB #217" },
    { drug: "Zitromax® (azitromicina)", dose: "1g per os", durata: "Dose singola (g1)", note: "Sostituisce eritromicina (Seaman AJOG 2022: OR corio 0,53)", fonte: "ACOG PB #217; SOGC" },
    { drug: "Zimox® (amoxicillina)", dose: "500mg per os ogni 8h", durata: "5 giorni (gg 3-7)", note: "Mercer originale: 250mg. Nostro protocollo: 500mg", fonte: "Mercer JAMA 1997" },
  ], footer: "TOTALE: 7 giorni poi STOP. MAI Augmentin® nella pPROM (ORACLE I: NEC). MAI prolungare oltre 7gg. MAI 'fino al parto'. Ri-trattare solo se nuova infezione." },

  { id: "pprom_supporto", title: "pPROM — CCS, Tocolisi, Neuroprotezione", icon: "🫁", rows: [
    { drug: "Betametasone (Bentelan®)", dose: "12mg IM ogni 24h × 2 dosi", durata: "2 giorni", note: "CCS maturazione polmonare. 23+0 — 33+6s. Rescue course se >14gg e <34s", fonte: "ACOG PB #217 2020; SMFM" },
    { drug: "MgSO₄ (solfato di magnesio)", dose: "Bolo 4g IV in 20-30min → 1g/h", durata: "Max 24h", note: "Neuroprotezione se <32s e parto imminente (Crowther JAMA 2003: ↓ PCI OR 0,69)", fonte: "ACTOMgSO4 Trial; ACOG" },
    { drug: "Atosiban (Tractocile®)", dose: "6,75mg bolo → 300μg/min × 3h → 100μg/min", durata: "Max 48h (per CCS)", note: "1ª scelta tocolisi IT/EU. Solo per permettere CCS, NON mantenimento", fonte: "RCOG GTG 73; SIGO" },
    { drug: "Nifedipina (Adalat®)", dose: "20mg per os → 10mg/15min × 3 → 20mg/6-8h", durata: "Max 48h", note: "1ª scelta RCOG/NICE. Off-label. Alternativa ad atosiban", fonte: "RCOG; NICE NG25" },
    { drug: "Indometacina (Indocid®)", dose: "50-100mg rettale → 25mg per os/6h", durata: "Max 48h. SOLO <32s", note: "STOP a 32s: rischio chiusura dotto arterioso", fonte: "ACOG; SMFM" },
  ], footer: "Tocolisi: SOLO per 48h per completare CCS. MAI tocolisi di mantenimento (ACOG PB #217; ORACLE II). Controindicata se: infezione, abruption, travaglio avanzato. Dopo 7gg antibiotici: STOP tutto." },

  { id: "tpl_integre", title: "Travaglio Pretermine a Membrane Integre (TPL)", icon: "⚡", rows: [
    { drug: "Antibiotici di latenza (Mercer)", dose: "CONTROINDICATI", durata: "—", note: "ORACLE II Kenyon Lancet 2001: follow-up 7aa → PCI 3,3% vs 1,7%. NESSUN beneficio e rischio di danno", fonte: "ORACLE II Lancet 2001/2008" },
    { drug: "IAP GBS — se GBS POSITIVO", dose: "Pen G 5 MUI→2,5-3 MUI/4h o Amplital® 2g→1g/4h", durata: "Fino al parto", note: "Se GBS positivo noto", fonte: "ACOG CO #797 2020" },
    { drug: "IAP GBS — se GBS IGNOTO", dose: "Pen G 5 MUI→2,5-3 MUI/4h o Amplital® 2g→1g/4h", durata: "Fino al parto", note: "Prematurità = FR per malattia GBS neonatale → IAP empirica", fonte: "ACOG CO #797 2020" },
    { drug: "IAP GBS — se GBS NEGATIVO", dose: "NESSUN antibiotico", durata: "—", note: "GBS negativo valido (<5 sett) → no antibiotici di nessun tipo", fonte: "ACOG CO #797 2020" },
    { drug: "Betametasone (Bentelan®)", dose: "12mg IM × 2 (ogni 24h)", durata: "Se 23-33+6s", note: "CCS maturazione polmonare", fonte: "ACOG; SMFM" },
    { drug: "MgSO₄ neuroprotezione", dose: "4g IV bolo → 1g/h (max 24h)", durata: "Se <32s e parto imminente", note: "↓ PCI OR 0,69 (ACTOMgSO4 JAMA 2003)", fonte: "ACOG" },
    { drug: "Tocolisi (per 48h)", dose: "Atosiban o Nifedipina o Indometacina (<32s)", durata: "Max 48h", note: "SOLO per completare CCS. MAI mantenimento", fonte: "RCOG; NICE NG25; SIGO" },
  ], footer: "⚠ CONCETTO CHIAVE: membrane INTEGRE + travaglio pretermine ≠ pPROM. L'unico antibiotico lecito è la IAP GBS se lo stato GBS lo richiede. Se il travaglio si arresta: STOP IAP, monitoraggio. Cerchiaggio: NON indicato in travaglio attivo." },

  { id: "prom_termine", title: "PROM a Termine (≥37s)", icon: "⏰", rows: [
    { drug: "NO antibiotici di latenza", dose: "—", durata: "—", note: "A termine non servono latenza (ACOG PB #217)", fonte: "ACOG PB #217 2020" },
    { drug: "IAP GBS se indicata", dose: "Pen G 5 MUI→2,5-3 MUI/4h o Amplital® 2g→1g/4h", durata: "Fino al parto", note: "Se GBS+, o GBS ignoto + rottura ≥18h o febbre", fonte: "ACOG CO #797 2020" },
  ], footer: "Indurre o attendere 12-24h (ACOG/SIGO). NICE: indurre a 24h. Tampone GBS valido entro 5 settimane." },

  { id: "iap_gbs", title: "Profilassi GBS Intrapartum (IAP)", icon: "🛡️", rows: [
    { drug: "Penicillina G (sodica)", dose: "5 MUI IV carico → 2,5-3 MUI/4h", durata: "Fino al parto", note: "1ª scelta LG — spettro ristretto", fonte: "ACOG CO #797 2020" },
    { drug: "Ampicillina (Amplital®)", dose: "2g IV carico → 1g IV/4h", durata: "Fino al parto", note: "Alternativa equivalente (ACOG CO #797). Più disponibile in IT", fonte: "ACOG CO #797 2020" },
    { drug: "Ampicillina (Amplital®)", dose: "2g IV carico → 1g/4h", durata: "Fino al parto", note: "Alternativa se Pen G non disponibile", fonte: "ACOG CO #797 2020" },
    { drug: "Cefazolina (Cefamezin®)", dose: "2g IV carico → 1g/8h", durata: "Fino al parto", note: "Allergia basso rischio (orticaria, rash)", fonte: "ACOG CO #797 2020" },
    { drug: "Clindamicina (Dalacin®)", dose: "900mg IV ogni 8h", durata: "Fino al parto", note: "Allergia alto rischio + GBS sensibile. ⚠ Possibile sottodosaggio PK (Muller 2010)", fonte: "ACOG CO #797 2020" },
    { drug: "Vancomicina (Vancotex®)", dose: "20mg/kg IV ogni 8h (max 2g)", durata: "Fino al parto (infus ≥1h)", note: "Allergia alto rischio + GBS R/ignoto clindamicina", fonte: "ACOG CO #797 2020" },
  ], footer: "IAP indicata: GBS+, batteriuria GBS, precedente neonato GBS, GBS ignoto + FR (pretermine, febbre, rottura ≥18h). Obiettivo: ≥4h prima del parto." },

  { id: "incomp_cerv", title: "Incompetenza Cervicale + Infezione", icon: "🔓", rows: [
    { drug: "Screening CV completo", dose: "BV, CT/NG, Ureaplasma, Mycoplasma + ABG", durata: "All'ammissione", note: "L'infezione è il target terapeutico modificabile", fonte: "Donders 2020; ScienceDirect 2025" },
    { drug: "Se tampone positivo → terapia MIRATA", dose: "Secondo patogeno", durata: "Secondo patogeno", note: "NON antibiotici empirici 'di copertura'", fonte: "ACOG PB #142 2014" },
    { drug: "Sacco in vagina + membrane INTEGRE", dose: "NO regime pPROM", durata: "—", note: "Solo screening + trattamento infezioni documentate", fonte: "ACOG/AAFP: evidenza insufficiente" },
    { drug: "Sacco in vagina + membrane ROTTE", dose: "Regime latenza pPROM 7gg", durata: "7 giorni", note: "Come pPROM standard (Mercer)", fonte: "ACOG PB #217 2020" },
    { drug: "Progesterone (Progeffik®)", dose: "200mg intravag/die", durata: "Fino a 36+6s", note: "SEMPRE, indipendentemente da antibiotici", fonte: "Cochrane; FIGO 2025" },
    { drug: "CCS: Betametasone (Bentelan®)", dose: "12mg IM × 2 (ogni 24h)", durata: "Se 23-34s", note: "Se parto imminente o prolasso avanzato", fonte: "ACOG; SMFM" },
    { drug: "MgSO₄ neuroprotezione", dose: "4g IV bolo → 1g/h (max 24h)", durata: "Se <32s e parto imminente", note: "Crowther JAMA 2003: ↓ PCI OR 0,69", fonte: "ACTOMgSO4; ACOG" },
  ], footer: "Senza cerchiaggio: screening + trattamento infezione = pilastro gestione. Antibiotici di copertura NON supportati dall'evidenza (ACOG; SMFM)." },

  { id: "corio", title: "Corioamnionite (IUI)", icon: "🔥", rows: [
    { drug: "Amplital® (ampicillina)", dose: "2g IV ogni 6h", durata: "Fino al parto", note: "Copre anche GBS", fonte: "ACOG CO #712; CPU 2024" },
    { drug: "Gentalyn® (gentamicina)", dose: "5mg/kg IV ogni 24h", durata: "Fino al parto", note: "Dose unica/die preferita (Dior 2021: ↓ endometrite 64%)", fonte: "ACOG CO #712 2017" },
    { drug: "+ Dalacin® se TC", dose: "900mg IV ogni 8h", durata: "Al clampaggio → apiressia", note: "Copertura anaerobi per cavità addominale", fonte: "ACOG CO #712 2017" },
  ], footer: "Criteri ACOG CPU 2024: T ≥39°C singola O T 38-38,9°C persistente ≥30min + ≥1 tra leucocitosi/tachicardia fetale/scolo purulento. Post parto vag: 1 dose poi stop. Post TC: fino apiressia ≥24h." },

  { id: "profilassi_tc", title: "Profilassi Taglio Cesareo", icon: "✂️", rows: [
    { drug: "Cefazolina (Cefamezin®)", dose: "2g IV (3g se ≥120kg)", durata: "Dose unica pre-incisione", note: "30-60min prima. Redose se >4h o perdita >1500mL", fonte: "ACOG PB #199 2018" },
    { drug: "+ Azitromicina (Zitromax®)", dose: "500mg IV", durata: "Dose unica", note: "Solo TC NON elettivi (travaglio o membrane rotte). C/SOAP Tita NEJM 2016", fonte: "Tita NEJM 2016" },
    { drug: "Allergia: Dalacin® + Gentalyn®", dose: "900mg + 5mg/kg IV", durata: "Dose unica pre-incisione", note: "Allergia severa β-lattamici", fonte: "ACOG PB #199 2018" },
  ], footer: "NON per TC elettivi a membrane integre (indipendentemente dal GBS). Se già in IAP con ampicillina per GBS: nessun antibiotico aggiuntivo per TC." },

  { id: "endometrite", title: "Endometrite Post-Partum", icon: "🌡️", rows: [
    { drug: "Dalacin® (clindamicina) + Gentalyn® (gentamicina)", dose: "900mg IV/8h + 5mg/kg IV/24h", durata: "Fino apiressia ≥24h", note: "Gold standard (Duff ObGyn 1983 RCT). NON copre Enterococcus", fonte: "Duff 1983; Cochrane CD001067" },
    { drug: "Se febbre persiste 48-72h → + Amplital®", dose: "2g IV ogni 6h", durata: "Aggiuntiva", note: "Sospettare Enterococcus. Aggiungere al regime, non sostituire", fonte: "ACOG PB #199 2018" },
    { drug: "Alternativa: Tazocin® (pip-tazo)", dose: "4,5g IV ogni 6h", durata: "Fino apiressia ≥24h", note: "Monoterapia. Spettro ampio (Gram+/−/anaerobi)", fonte: "AOGOI/ISS; RCOG GTG 64 2025" },
  ], footer: "Post-apiressia: NON proseguire con antibiotici orali (Cochrane CD001067: nessun beneficio). Se mancata risposta 48-72h: escludere ascesso pelvico (eco/TC), tromboflebite settica ('enigmatic fever' → eparina), ritenzione materiale placentare." },

  { id: "mastite", title: "Mastite Puerperale e Ascesso", icon: "🤱", rows: [
    { drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6h", durata: "10-14 giorni", note: "1ª scelta in IT. Copre S. aureus sensibile", fonte: "ACOG; ABM Protocol #36" },
    { drug: "Amox-clav (Augmentin®)", dose: "875/125mg per os ogni 12h", durata: "10-14 giorni", note: "Alternativa a spettro più ampio", fonte: "ACOG; ABM Protocol #36" },
    { drug: "Flucloxacillina (Flucacid®)", dose: "500mg per os ogni 6h", durata: "10-14 giorni", note: "Gold standard UK (anti-stafilococcica)", fonte: "NICE CKS Mastitis 2024" },
    { drug: "TMP-SMX (Bactrim®)", dose: "160/800mg per os ogni 12h", durata: "10-14 giorni", note: "Se sospetto CA-MRSA. Compatibile con allattamento (LactMed)", fonte: "ABM Protocol #36; LactMed" },
    { drug: "Vancomicina (Vancotex®)", dose: "15-20mg/kg IV ogni 8-12h", durata: "10-14 giorni (guidata da colture)", note: "Ascesso severo / MRSA confermato / sepsi", fonte: "IDSA MRSA GL 2011" },
  ], footer: "Eziologia: S. aureus ~75%. Drenaggio del latte OBBLIGATORIO. Se ascesso >3cm: drenaggio eco-guidato. Allattamento: CONTINUARE (salvo ascesso periareolare drenato). Tutti i farmaci elencati compatibili con allattamento (LactMed NIH)." },

  { id: "ferita_tc", title: "Infezione Ferita Post-TC", icon: "🩹", rows: [
    { drug: "Apertura + drenaggio + irrigazione", dose: "—", durata: "—", note: "Fondamento del trattamento. Antibiotici SECONDARI al drenaggio", fonte: "ACOG PB #199; WHO SSI 2018" },
    { drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6h", durata: "7-10 giorni", note: "Infezione superficiale senza cellulite estesa", fonte: "ACOG PB #199 2018" },
    { drug: "Amox-clav (Augmentin®)", dose: "875/125mg per os ogni 12h", durata: "7-10 giorni", note: "Se polimicrobica (anaerobi coinvolti)", fonte: "ACOG PB #199 2018" },
    { drug: "Se MRSA: TMP-SMX (Bactrim®)", dose: "160/800mg per os ogni 12h", durata: "7-10 giorni", note: "Coltura con antibiogramma raccomandato", fonte: "IDSA MRSA GL 2011" },
  ], footer: "Incidenza 3-15% post-TC. Patogeni: flora mista (S. aureus, Streptococchi, E. coli, anaerobi). Se fascite necrotizzante: chirurgia urgente + carbapenemici IV + consulenza chirurgica." },

  { id: "ureaplasma_myco", title: "Ureaplasma e Mycoplasma", icon: "🔬", rows: [
    { drug: "Ureaplasma — Azitromicina (Zitromax®)", dose: "1g per os singola OPPURE 500mg g1 → 250mg gg2-5", durata: "1 giorno o 5 giorni", note: "1ª scelta. Trattare SOLO se: LA+, pPROM, cervicite senza altra causa", fonte: "CDC STI GL 2021; Cochrane CD003767" },
    { drug: "Ureaplasma — Josamicina (Iosalide®)", dose: "500mg per os ogni 8h", durata: "10 giorni", note: "Macrolide a 16 atomi — attivo vs azitro-R. Alternativa", fonte: "Pratica clinica (non LG)" },
    { drug: "Ureaplasma — Clindamicina (Dalacin®)", dose: "300mg per os ogni 8h", durata: "7 giorni", note: "Se co-infezione M. hominis. Copre entrambi", fonte: "CDC STI GL 2021" },
    { drug: "M. hominis — Clindamicina (Dalacin®)", dose: "300mg per os ogni 8h", durata: "7 giorni", note: "1ª scelta. M. hominis è INTRINSECAMENTE resistente ai macrolidi!", fonte: "CDC STI GL 2021" },
    { drug: "M. genitalium sens. macrolidi — Azitromicina", dose: "1g g1 → 500mg gg2-4", durata: "4 giorni", note: "SOLO se test RAM negativo. Resistenza macrolidi 44-90%!", fonte: "CDC 2021; IUSTI M.gen 2021" },
    { drug: "M. genitalium R macrolidi — Pristinamicina", dose: "1g per os ogni 8h", durata: "10 giorni", note: "Efficacia 70-75%. CONSULENZA INFETTIVOLOGICA", fonte: "STI GL Australia 2021" },
  ], footer: "Screening Ureaplasma di routine NON raccomandato (Cochrane CD003767). M. genitalium: test RAM (Resistance-Associated Mutations) PRIMA del trattamento (CDC/IUSTI). Se M. genitalium R: considerare differire a post-partum (tutte le LG concordano)." },

  { id: "trichomonas", title: "Trichomonas vaginalis", icon: "🟢", rows: [
    { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os ogni 12h", durata: "7 giorni", note: "SOLO se SINTOMATICA. Asintomatica: NON trattare (Klebanoff NEJM 2001: ↑ PTB con trattamento)", fonte: "CDC STI GL 2021" },
    { drug: "Alternativa: Metronidazolo", dose: "2g per os", durata: "Dose singola", note: "Compliance migliore ma tassi di guarigione inferiori in gravidanza", fonte: "CDC STI GL 2021" },
  ], footer: "⚠ Trattare asintomatiche in gravidanza può AUMENTARE il rischio di parto pretermine (Klebanoff NEJM 2001;345:487). CDC 2021: trattare solo sintomatiche. Dose singola 2g vs 7gg: i 7gg hanno tassi guarigione migliori in gravidanza." },
];

const FORMULARY_DATA = [
  { cat: "IVU", items: [
    { drug: "Fosfomicina (Monuril®)", dose: "3g per os dose unica", ind: "BA, cistite", ci: "NO pielo", fonte: "ACOG CC No.4" },
    { drug: "Cefalexina (Keforal®)", dose: "250-500mg per os ogni 6h", ind: "Cistite, step-down pielo, soppressiva", ci: "Allergia cefalosporine", fonte: "ACOG CC No.4" },
    { drug: "Nitrofurantoina (Neofuradantin®)", dose: "100mg per os ogni 12h", ind: "Cistite, BA, soppressiva", ci: "G6PD, ≥36-38s, pielo, IRC", fonte: "ACOG CC No.4; NICE" },
    { drug: "TMP-SMX (Bactrim®)", dose: "160/800mg per os ogni 12h", ind: "Cistite (solo II trim)", ci: "I trim (NTD), ≥36s (kernicterus)", fonte: "ACOG CC No.4" },
    { drug: "Ceftriaxone (Rocefin®)", dose: "1-2g IV ogni 24h", ind: "Pielo, IVU complicata, NG", ci: "Cautela peripartum", fonte: "ACOG CC No.4" },
  ]},
  { cat: "Cervicovaginali", items: [
    { drug: "Metronidazolo (Flagyl®)", dose: "500mg per os 2v/die × 7gg", ind: "BV, Trichomonas", ci: "Nessuna in gravidanza", fonte: "CDC 2021; Burtin 1995" },
    { drug: "Clotrimazolo (Canesten®)", dose: "Crema 1% 5g intravag × 7gg", ind: "Candidosi", ci: "—", fonte: "CDC 2021" },
    { drug: "Azitromicina (Zitromax®)", dose: "1g per os singola", ind: "CT, Ureaplasma, pPROM", ci: "—", fonte: "CDC 2021; ACOG PB #217" },
    { drug: "Clindamicina (Dalacin®)", dose: "300mg per os 3v/die × 7gg", ind: "BV (alt.), M. hominis", ci: "—", fonte: "CDC 2021" },
    { drug: "Meclon® (metro+clotrim)", dose: "1 ovulo intravag/die × 6-10gg", ind: "Infezione mista BV+Candida", ci: "—", fonte: "Pratica IT (non LG)" },
    { drug: "Macmiror Complex®", dose: "1 ovulo intravag/die × 8-10gg", ind: "Mista (Trichom+Candida)", ci: "—", fonte: "Pratica IT (non LG)" },
  ]},
  { cat: "Latenza pPROM", items: [
    { drug: "Ampicillina (Amplital®)", dose: "2g IV ogni 6h × 48h", ind: "Fase IV (gg 1-2)", ci: "Allergia penicilline", fonte: "Mercer JAMA 1997" },
    { drug: "Azitromicina (Zitromax®)", dose: "1g per os singola", ind: "Sostituisce eritromicina", ci: "Allergia macrolidi", fonte: "Seaman AJOG 2022" },
    { drug: "Amoxicillina (Zimox®)", dose: "250-500mg per os ogni 8h × 5gg", ind: "Fase OS (gg 3-7)", ci: "—", fonte: "Mercer JAMA 1997" },
  ]},
  { cat: "IAP / Corioamnionite", items: [
    { drug: "Penicillina G (sodica)", dose: "5 MUI IV → 2,5-3 MUI/4h", ind: "IAP GBS 1ª scelta (spettro ristretto)", ci: "Allergia penicilline. Spesso non disponibile in IT", fonte: "ACOG CO #797" },
    { drug: "Ampicillina (Amplital®) per IAP", dose: "2g IV carico → 1g IV ogni 4h", ind: "IAP GBS alternativa equivalente. Disponibile ovunque", ci: "Allergia penicilline", fonte: "ACOG CO #797" },
    { drug: "Ampicillina (Amplital®)", dose: "2g IV → 1g/4h", ind: "IAP alt. + corioamnionite", ci: "Allergia penicilline", fonte: "ACOG CO #797; CO #712" },
    { drug: "Cefazolina (Cefamezin®)", dose: "2g IV → 1g/8h", ind: "IAP allergia basso rischio", ci: "Allergia cefalosporine", fonte: "ACOG CO #797" },
    { drug: "Clindamicina (Dalacin®)", dose: "900mg IV ogni 8h", ind: "IAP allergia alto + GBS S", ci: "PK subterapeutica (Muller 2010)", fonte: "ACOG CO #797" },
    { drug: "Vancomicina (Vancotex®)", dose: "20mg/kg IV ogni 8h (max 2g)", ind: "IAP allergia alto + GBS R", ci: "Infusione ≥1h", fonte: "ACOG CO #797" },
    { drug: "Gentamicina (Gentalyn®)", dose: "5mg/kg IV ogni 24h", ind: "Corioamnionite + ampicillina", ci: "TDM se >5gg", fonte: "ACOG CO #712" },
  ]},
  { cat: "Profilassi chirurgica", items: [
    { drug: "Cefazolina (Cefamezin®)", dose: "2g IV (3g se ≥120kg) pre-incisione", ind: "TC", ci: "Allergia cefalosporine", fonte: "ACOG PB #199" },
    { drug: "Azitromicina (Zitromax®)", dose: "500mg IV dose unica", ind: "TC non elettivo (+ cefazolina)", ci: "—", fonte: "Tita NEJM 2016" },
  ]},
  { cat: "Post-partum (endometrite, mastite, ferita)", items: [
    { drug: "Dalacin® (clindamicina IV)", dose: "900mg IV ogni 8h", ind: "Endometrite (+ gentamicina)", ci: "—", fonte: "Duff 1983; Cochrane CD001067" },
    { drug: "Gentalyn® (gentamicina IV)", dose: "5mg/kg IV ogni 24h", ind: "Endometrite (+ clindamicina)", ci: "TDM se >5gg", fonte: "ACOG; Dior 2021" },
    { drug: "Tazocin® (pip-tazo)", dose: "4,5g IV ogni 6h", ind: "Endometrite severa / sepsi (monoterapia)", ci: "Allergia penicilline", fonte: "AOGOI; RCOG GTG 64" },
    { drug: "Cefalexina (Keforal®)", dose: "500mg per os ogni 6h × 10-14gg", ind: "Mastite, infezione ferita", ci: "Allergia cefalosporine", fonte: "ACOG; ABM Protocol #36" },
    { drug: "Flucloxacillina (Flucacid®)", dose: "500mg per os ogni 6h × 10-14gg", ind: "Mastite (gold standard UK)", ci: "Allergia penicilline", fonte: "NICE CKS Mastitis 2024" },
    { drug: "Amox-clav (Augmentin®)", dose: "875/125mg per os ogni 12h × 10-14gg", ind: "Mastite, ferita (polimicrobica)", ci: "—", fonte: "ACOG; ABM Protocol #36" },
  ]},
  { cat: "Ureaplasma / Mycoplasma", items: [
    { drug: "Azitromicina (Zitromax®)", dose: "1g per os singola o 500mg g1→250mg gg2-5", ind: "Ureaplasma, M. genitalium (macrolide-S)", ci: "—", fonte: "CDC 2021" },
    { drug: "Josamicina (Iosalide®)", dose: "500mg per os ogni 8h × 10gg", ind: "Ureaplasma (alternativa azitro-R)", ci: "—", fonte: "Pratica clinica (non LG)" },
    { drug: "Clindamicina (Dalacin®)", dose: "300mg per os ogni 8h × 7gg", ind: "M. hominis (1ª scelta — R intrinseca a macrolidi!)", ci: "—", fonte: "CDC 2021" },
    { drug: "Pristinamicina", dose: "1g per os ogni 8h × 10gg", ind: "M. genitalium macrolide-R (efficacia 70-75%)", ci: "Consulenza infettivologica", fonte: "STI GL Australia 2021" },
  ]},
  { cat: "Farmaci IV di riserva", items: [
    { drug: "Ertapenem (Invanz®)", dose: "1g IV ogni 24h", ind: "IVU ESBL+, pielo complicata", ci: "Allergia carbapenemi", fonte: "IDSA cUTI 2025" },
    { drug: "Aztreonam (Azactam®)", dose: "1g IV ogni 8-12h", ind: "IVU/pielo — allergia β-latt (cross-reattività minima)", ci: "—", fonte: "ACOG CC No.4 2023" },
    { drug: "Pip-tazo (Tazocin®)", dose: "4,5g IV ogni 6h", ind: "Pielo complicata, endometrite, sepsi", ci: "Allergia penicilline", fonte: "AOGOI; RCOG GTG 64" },
    { drug: "Eritromicina (Eritrocina®)", dose: "250mg per os ogni 6h (etilsuccinato 600mg)", ind: "Regime Mercer originale (alternativa RCOG × 10gg)", ci: "GI, flebite IV", fonte: "Mercer 1997; RCOG GTG 73" },
    { drug: "Metronidazolo IV (Deflamon®)", dose: "500mg IV ogni 8h", ind: "Corioamnionite (+ ampi+genta), endometrite", ci: "—", fonte: "ACOG CO #712" },
    { drug: "Claritromicina", dose: "500mg per os ogni 12h × 7-14gg", ind: "Protocollo Romero/Barcelona sacco in vagina", ci: "Dati animali — beneficio > rischio in questo contesto", fonte: "Romero AJOG 2016" },
  ]},
];

const SAFETY_DATA = [
  { drug: "Ampicillina/Amoxicillina", i: "✓", ii: "✓", iii: "✓", note: "Sicura. Amox-clav: CI solo nella pPROM" },
  { drug: "Cefalosporine (1ª-3ª gen)", i: "✓", ii: "✓", iii: "✓", note: "Keforal®, Cefamezin®, Rocefin® — sicure" },
  { drug: "Azitromicina", i: "✓", ii: "✓", iii: "✓", note: "Sicura. Cat B. Sostituisce eritromicina" },
  { drug: "Metronidazolo", i: "✓", ii: "✓", iii: "✓", note: "Sicuro TUTTI i trimestri (Burtin 1995: OR 0,93)" },
  { drug: "Clindamicina", i: "✓", ii: "✓", iii: "✓", note: "Sicura OS/IV. PK alterata in gravidanza" },
  { drug: "Fosfomicina", i: "✓", ii: "✓", iii: "✓", note: "Sicura. Solo IVU basse" },
  { drug: "Nitrofurantoina", i: "⚠", ii: "✓", iii: "⚠", note: "I trim: usare se no alternative. STOP 36-38s. CI: G6PD" },
  { drug: "TMP-SMX (Bactrim®)", i: "✗", ii: "✓", iii: "⚠", note: "I trim: CI (antifolato→NTD). ≥36s: CI (kernicterus)" },
  { drug: "Vancomicina", i: "✓", ii: "✓", iii: "✓", note: "Sicura IV. Weight-based 20mg/kg" },
  { drug: "Gentamicina", i: "⚠", ii: "⚠", iii: "⚠", note: "Ototossicità teorica. Cicli brevi OK. TDM se >5gg" },
  { drug: "Fluorochinoloni", i: "✗", ii: "✗", iii: "✗", note: "CI routinaria. Dati umani rassicuranti per esposizione accidentale" },
  { drug: "Tetracicline/Doxiciclina", i: "✗", ii: "✗", iii: "✗", note: "Deposito osseo/dentale fetale. CI assoluta" },
  { drug: "Fluconazolo (orale)", i: "✗", ii: "✗", iii: "✗", note: "CI qualsiasi dose (NEJM 2013: ToF OR 3,16)" },
  { drug: "Amox-clav (Augmentin®)", i: "✓", ii: "✓", iii: "⚠", note: "VIETATO nella pPROM. Cautela in pretermine <34s. OK per IVU/altre a termine" },
  { drug: "Eritromicina", i: "✓", ii: "✓", iii: "✓", note: "Sicura. Scarsa tollerabilità GI. Sostituita da azitromicina" },
  { drug: "Pip-tazo (Tazocin®)", i: "✓", ii: "✓", iii: "✓", note: "Sicura IV. Per sepsi/endometrite severa" },
  { drug: "Ertapenem (Invanz®)", i: "✓", ii: "✓", iii: "✓", note: "Dati limitati ma rassicuranti. Per ESBL+" },
  { drug: "Flucloxacillina", i: "✓", ii: "✓", iii: "✓", note: "Sicura. Anti-stafilococcica. Compatibile allattamento" },
  { drug: "Pristinamicina", i: "⚠", ii: "⚠", iii: "⚠", note: "Dati molto limitati. Solo per M.gen R — consulenza infettivologica" },
  { drug: "Aztreonam (Azactam®)", i: "✓", ii: "✓", iii: "✓", note: "Monobattamico. Cross-reattività β-latt <1%. Opzione chiave allergia alto rischio" },
  { drug: "Meropenem", i: "⚠", ii: "⚠", iii: "⚠", note: "Carbapenemico. Case series rassicuranti. Riserva sepsi grave/ESBL+" },
  { drug: "Teicoplanina (Targosid®)", i: "⚠", ii: "⚠", iii: "⚠", note: "Glicopeptide. Alternativa IT a vancomicina. Dati scarsi. Off-label" },
  { drug: "Amikacina", i: "⚠", ii: "⚠", iii: "⚠", note: "Aminoglicoside. Come gentamicina. Solo per genta-R. TDM obbligatorio" },
  { drug: "Claritromicina", i: "⚠", ii: "⚠", iii: "⚠", note: "Dati animali sfavorevoli. Solo se no alternative (azitro/eritro)" },
  { drug: "Linezolid", i: "⚠", ii: "⚠", iii: "⚠", note: "Oxazolidinone. Dati molto limitati. Riserva MRSA/VRE. Consulenza infettivologica" },
  { drug: "Daptomicina", i: "⚠", ii: "⚠", iii: "⚠", note: "Lipopeptide. Nessun dato in gravidanza. Riserva assoluta Gram+ MDR" },
  { drug: "Colistina", i: "✗", ii: "✗", iii: "✗", note: "Polimixina. Nefro/neurotossica. Solo se vita materna a rischio — pan-resistenti" },
];

function RefCard({ title, rows, footer, color }) {
  return (
    <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 12, border: "1px solid #E0E0E0" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || "#1A3C5E", marginBottom: 8 }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead><tr style={{ background: "#F0F4F8" }}>
            <th style={{ padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #1A3C5E", fontWeight: 700 }}>Farmaco</th>
            <th style={{ padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #1A3C5E" }}>Posologia</th>
            <th style={{ padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #1A3C5E" }}>Durata</th>
            <th style={{ padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #1A3C5E" }}>Note</th>
            <th style={{ padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #1A3C5E", fontSize: 10 }}>Fonte</th>
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #ECF0F1", background: r.dose === "—" ? "#FEF9E7" : (r.ci ? "#FDEDEC" : "white") }}>
              <td style={{ padding: "5px 8px", fontWeight: 600 }}>{r.drug}</td>
              <td style={{ padding: "5px 8px" }}>{r.dose}</td>
              <td style={{ padding: "5px 8px", fontWeight: 600, color: r.durata === "Dose unica" ? "#27AE60" : "#1A3C5E" }}>{r.durata}</td>
              <td style={{ padding: "5px 8px", fontSize: 10 }}>{r.note}</td>
              <td style={{ padding: "5px 8px", fontSize: 9, color: "#7F8C8D" }}>{r.fonte}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {footer && <div style={{ marginTop: 8, padding: "6px 10px", background: "#F0F4F8", borderRadius: 6, fontSize: 10, color: "#2C3E50" }}>{footer}</div>}
    </div>
  );
}

function ProtocolCards() {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <div style={{ fontSize: 13, color: "#7F8C8D", marginBottom: 10 }}>Clicca su uno scenario per visualizzare il protocollo completo con fonti</div>
      {PROTOCOL_CARDS.map(c => (
        <div key={c.id}>
          <button onClick={() => setOpen(open === c.id ? null : c.id)}
            style={{ width: "100%", padding: "10px 14px", background: open === c.id ? "#E8F6F3" : "white", border: `1.5px solid ${open === c.id ? "#0E7C6B" : "#E0E0E0"}`,
              borderRadius: 8, cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600, color: "#1A3C5E", marginBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{c.icon} {c.title}</span>
            <span style={{ fontSize: 16 }}>{open === c.id ? "▲" : "▼"}</span>
          </button>
          {open === c.id && <RefCard title={c.title} rows={c.rows} footer={c.footer} />}
        </div>
      ))}
      <div style={{ textAlign: "center", fontSize: 9, color: "#BDC3C7", marginTop: 12 }}>Tutti i protocolli sono evidence-based. Le pratiche empiriche sono segnalate come tali.</div>
    </div>
  );
}

function Formulary() {
  const [search, setSearch] = useState("");
  const filtered = FORMULARY_DATA.map(cat => ({
    ...cat,
    items: cat.items.filter(i => !search || i.drug.toLowerCase().includes(search.toLowerCase()) || i.ind.toLowerCase().includes(search.toLowerCase()))
  })).filter(cat => cat.items.length > 0);

  return (
    <div>
      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Cerca farmaco o indicazione..."
        style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #D5DBDB", borderRadius: 8, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }} />
      {filtered.map(cat => (
        <div key={cat.cat} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0E7C6B", marginBottom: 6, borderBottom: "2px solid #0E7C6B", paddingBottom: 3 }}>{cat.cat}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ background: "#F0F4F8" }}>
              <th style={{ padding: "5px 6px", textAlign: "left" }}>Farmaco</th>
              <th style={{ padding: "5px 6px", textAlign: "left" }}>Posologia</th>
              <th style={{ padding: "5px 6px", textAlign: "left" }}>Indicazione</th>
              <th style={{ padding: "5px 6px", textAlign: "left" }}>CI/Cautele</th>
              <th style={{ padding: "5px 6px", textAlign: "left", fontSize: 9 }}>Fonte</th>
            </tr></thead>
            <tbody>{cat.items.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #ECF0F1" }}>
                <td style={{ padding: "4px 6px", fontWeight: 600 }}>{r.drug}</td>
                <td style={{ padding: "4px 6px" }}>{r.dose}</td>
                <td style={{ padding: "4px 6px" }}>{r.ind}</td>
                <td style={{ padding: "4px 6px", color: r.ci && r.ci !== "—" ? "#C0392B" : "#7F8C8D", fontSize: 10 }}>{r.ci}</td>
                <td style={{ padding: "4px 6px", fontSize: 9, color: "#95A5A6" }}>{r.fonte}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      <div style={{ textAlign: "center", fontSize: 9, color: "#BDC3C7", marginTop: 8 }}>Dati da ACOG, CDC, AIFA, Codifa — verificati marzo 2026</div>
    </div>
  );
}

function SafetyTable() {
  return (
    <div>
      <div style={{ fontSize: 13, color: "#7F8C8D", marginBottom: 8 }}>✓ = Sicuro  ⚠ = Cautela/restrizioni  ✗ = Controindicato</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead><tr style={{ background: "#1A3C5E", color: "white" }}>
            <th style={{ padding: "8px", textAlign: "left" }}>Antibiotico</th>
            <th style={{ padding: "8px", textAlign: "center", width: 50 }}>I trim</th>
            <th style={{ padding: "8px", textAlign: "center", width: 50 }}>II trim</th>
            <th style={{ padding: "8px", textAlign: "center", width: 50 }}>III trim</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Note</th>
          </tr></thead>
          <tbody>{SAFETY_DATA.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #ECF0F1", background: i % 2 === 0 ? "white" : "#F8F9FA" }}>
              <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.drug}</td>
              {[r.i, r.ii, r.iii].map((v, j) => (
                <td key={j} style={{ padding: "6px 8px", textAlign: "center", fontSize: 16,
                  color: v === "✓" ? "#27AE60" : v === "⚠" ? "#E67E22" : "#C0392B" }}>{v}</td>
              ))}
              <td style={{ padding: "6px 8px", fontSize: 10 }}>{r.note}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, padding: "8px 12px", background: "#FEF9E7", borderRadius: 6, fontSize: 10, color: "#E67E22" }}>
        ⚠ La vecchia classificazione FDA (A/B/C/D/X) è stata abbandonata nel 2015. Questa tabella riflette l'evidenza aggiornata al marzo 2026. Fonti: ACOG, CDC, AIFA farmaciegravidanza.gov.it, Briggs "Drugs in Pregnancy and Lactation" 12th ed 2022.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACCESS CODE — change this to set a new code for your users
// ═══════════════════════════════════════════════════════════════
const ACCESS_CODE = "BARI2026";

export default function App() {
  // ═══ AUTH STATE ═══
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ nome: "", cognome: "", codice: "" });
  const [loginError, setLoginError] = useState("");

  const handleLogin = () => {
    const { nome, cognome, codice } = loginForm;
    if (!nome.trim() || !cognome.trim()) { setLoginError("Inserisci nome e cognome"); return; }
    if (codice.trim().toUpperCase() !== ACCESS_CODE) { setLoginError("Codice di accesso non valido"); return; }
    const u = { nome: nome.trim(), cognome: cognome.trim(), fullName: `${nome.trim()} ${cognome.trim()}` };
    setUser(u);
    setLoginError("");
  };

  const handleLogout = () => {
    setUser(null);
  };

  // ═══ ALL APP HOOKS (must be before any conditional return) ═══
  const [data, setData] = useState({
    scenario: null, scenarios: [], eg: null, pesoKg: null, creatinina: null,
    allergie: { stato: "non_noto" },
    temperatura: null, fcMaterna: null, fcFetale: null, tempPersistente: false,
    wbc: null, crp: null, gbsStatus: null, gbsData: null,
    membraneStatus: null, oreRottura: null, tamponeCVResult: null, tamponeCV_ABG: {},
    urocoltura: null, uroABG: {}, esameUrineNitrati: null, esameUrineLeucociti: null,
    sintomiUrinari: null, sintomiVaginali: null, precedenteNeonatoGBS: false,
    precedentePTB: false, g6pd: false, tamponeDisponibile: null, sintomiVaginaliDettaglio: null,
    batteriuriaGBS: false, tcElettivoMI: false, ivuRicorrenti: false,
    cerchiaggio: false, gbsPrecedenteGrav: false, fasePprom: null,
    saccoInVagina: false, dilatazioneCervicale: null, idronefrosiGrado: null, doloreColica: null, sottoscenarioIC: null,
    antibioticiInCorso: "no", abxInCorsoNome: "", abxInCorsoGiorni: null,
    emocoltura: null, emocolturaGerme: "",
  });

  const [showResult, setShowResult] = useState(false);
  const update = useCallback((field, value) => { setData(prev => ({ ...prev, [field]: value })); setShowResult(false); }, []);
  const toggleScenario = useCallback((id) => {
    setData(prev => {
      const has = prev.scenarios.includes(id);
      const next = has ? prev.scenarios.filter(s => s !== id) : [...prev.scenarios, id];
      return { ...prev, scenarios: next, scenario: next[0] || null };
    });
    setShowResult(false);
  }, []);

  const results = useMemo(() => {
    if (!showResult || data.scenarios.length === 0 || !data.eg) return null;

    // ═══ SMART SCENARIO RESOLUTION ═══
    // Resolve conflicting/overlapping scenarios before running engine
    let resolvedScenarios = [...data.scenarios];
    let resolvedData = { ...data };
    const needsClarification = [];

    // pPROM + Travaglio → merge into pPROM with correct phase
    if (resolvedScenarios.includes("pprom") && resolvedScenarios.includes("travaglio")) {
      resolvedScenarios = resolvedScenarios.filter(s => s !== "travaglio");
      if (!resolvedData.fasePprom || resolvedData.fasePprom === "conservativa") {
        // Infer phase from current antibiotics
        if (resolvedData.antibioticiInCorso === "si_latenza") {
          const gg = resolvedData.abxInCorsoGiorni;
          if (gg && gg <= 2) {
            resolvedData.fasePprom = "travaglio_in_latenza";
            needsClarification.push(`pPROM + Travaglio: latenza giorno ${gg} (fase IV in corso) → ampicillina IV copre GBS`);
          } else if (gg && gg > 2 && gg <= 7) {
            resolvedData.fasePprom = "travaglio_in_latenza_os";
            needsClarification.push(`pPROM + Travaglio: latenza giorno ${gg} (fase ORALE in corso) → serve SWITCH a IV per IAP GBS`);
          } else if (gg && gg > 7) {
            resolvedData.fasePprom = "travaglio_post_latenza";
            needsClarification.push(`pPROM + Travaglio: latenza completata (giorno ${gg}) → antibiotici sospesi, serve IAP GBS separata`);
          } else {
            resolvedData.fasePprom = "travaglio_in_latenza";
            needsClarification.push("pPROM + Travaglio: latenza in corso (giorno non specificato) — INSERIRE i giorni di terapia per una guida precisa");
          }
        } else if (resolvedData.antibioticiInCorso === "no") {
          resolvedData.fasePprom = "travaglio_post_latenza";
          needsClarification.push("pPROM + Travaglio: nessun antibiotico in corso → latenza probabilmente completata. Serve IAP GBS separata");
        } else {
          if (!resolvedData.fasePprom) resolvedData.fasePprom = "travaglio_post_latenza";
          needsClarification.push("pPROM + Travaglio: indicare se la latenza è in corso o completata nella sezione 'Fase pPROM'");
        }
      } else {
        needsClarification.push(`pPROM + Travaglio combinati → gestione unificata: ${resolvedData.fasePprom.replace(/_/g, " ")}`);
      }
    }

    // pPROM + PROM termine → impossible, pick based on EG
    if (resolvedScenarios.includes("pprom") && resolvedScenarios.includes("promTermine")) {
      if (resolvedData.eg >= 37) {
        resolvedScenarios = resolvedScenarios.filter(s => s !== "pprom");
        needsClarification.push("EG ≥37s: reclassificata come PROM a termine (non pPROM)");
      } else {
        resolvedScenarios = resolvedScenarios.filter(s => s !== "promTermine");
        needsClarification.push("EG <37s: reclassificata come pPROM (non PROM a termine)");
      }
    }

    // Run engine for each resolved scenario, combine results
    const allDiagnosi = [], allProtocollo = [], allAlerts = [], allMonitoraggio = [], allFonti = new Set();
    const drugsSeen = new Set();

    // Add clarification notes first
    if (needsClarification.length > 0) {
      needsClarification.forEach(n => allAlerts.push({ type: "info", text: `🔄 Risoluzione automatica: ${n}` }));
    }

    for (const sc of resolvedScenarios) {
      const singleData = { ...resolvedData, scenario: sc };
      const r = generateProtocol(singleData);
      r.diagnosi.forEach(d => allDiagnosi.push(d));
      r.protocollo.forEach(p => {
        const filtered = p.items.filter(item => {
          const key = item.drug + "|" + item.dose;
          if (drugsSeen.has(key)) return false;
          drugsSeen.add(key);
          return true;
        });
        if (filtered.length > 0) allProtocollo.push({ ...p, label: resolvedScenarios.length > 1 ? `[${sc.toUpperCase()}] ${p.label}` : p.label, items: filtered });
      });
      r.alerts.forEach(a => { if (!allAlerts.some(ea => ea.text === a.text)) allAlerts.push(a); });
      r.monitoraggio.forEach(m => { if (!allMonitoraggio.includes(m)) allMonitoraggio.push(m); });
      r.fonti.forEach(f => allFonti.add(f));
    }

    // ═══ CURRENT ANTIBIOTICS INTERACTION CHECK ═══
    const abxCorso = resolvedData.antibioticiInCorso;
    const abxNome = (resolvedData.abxInCorsoNome || "").toLowerCase();
    if (abxCorso && abxCorso !== "no") {
      const allNewDrugs = [...drugsSeen].map(k => k.split("|")[0].toLowerCase());

      if (abxNome) {
        // Check if current abx is the same as a proposed one
        const overlap = allNewDrugs.some(d => abxNome.includes(d.split(" ")[0].toLowerCase()) || d.includes(abxNome.split(" ")[0]));
        if (overlap) {
          allAlerts.push({ type: "warning", text: `Paziente già in terapia con ${resolvedData.abxInCorsoNome}${resolvedData.abxInCorsoGiorni ? ` (giorno ${resolvedData.abxInCorsoGiorni})` : ""}. Farmaco presente anche nel nuovo protocollo — CONTINUARE senza duplicare la dose` });
        } else {
          allAlerts.push({ type: "info", text: `Terapia in corso: ${resolvedData.abxInCorsoNome}${resolvedData.abxInCorsoGiorni ? ` (giorno ${resolvedData.abxInCorsoGiorni})` : ""}. Verificare compatibilità con il nuovo regime. Se indicato, SOSPENDERE e SOSTITUIRE — non sovrapporre` });
        }
      }

      // Latency antibiotics in corso + new protocol
      if (abxCorso === "si_latenza" && resolvedScenarios.includes("travaglio")) {
        allAlerts.push({ type: "warning", text: "Antibiotici di LATENZA in corso → verificare se coprono già il GBS. Se ampicillina IV → copertura GBS adeguata. Se clindamicina → valutare vancomicina aggiuntiva se GBS R/ignoto" });
      }
    }

    // ═══ EMOCOLTURA ALERTS ═══
    if (resolvedData.emocoltura === "positiva" && resolvedData.emocolturaGerme) {
      allAlerts.unshift({ type: "danger", text: `🩸 EMOCOLTURA POSITIVA: ${resolvedData.emocolturaGerme}. SEPSI fino a prova contraria — adattare terapia antibiotica all'emocoltura. Consulenza infettivologica URGENTE` });
      allMonitoraggio.push("Emocolture di controllo dopo 48-72h di terapia mirata", "Procalcitonina seriata per guida alla durata", "Valutare ecocardiografia se batteriemia persistente");
    } else if (resolvedData.emocoltura === "in_attesa") {
      allAlerts.push({ type: "warning", text: "Emocolture in corso — adattare terapia appena risultato disponibile" });
    }

    // ═══ CROSS-SCENARIO INTERACTION CHECKS ═══
    const scs = resolvedScenarios;
    const allDrugNames = [...drugsSeen].map(k => k.split("|")[0].toLowerCase());
    const hasMetro = allDrugNames.some(d => d.includes("metronidazolo") || d.includes("flagyl"));
    const hasGenta = allDrugNames.some(d => d.includes("gentamicina") || d.includes("gentalyn"));
    const hasNitro = allDrugNames.some(d => d.includes("nitrofurantoina") || d.includes("neofurad"));
    const hasAmpi = allDrugNames.some(d => d.includes("ampicillina") || d.includes("amplital"));
    const hasClinda = allDrugNames.some(d => d.includes("clindamicina") || d.includes("dalacin"));

    if (scs.length > 1) {
      allAlerts.unshift({ type: "warning", text: `⚡ SCENARI MULTIPLI ATTIVI: ${scs.map(s => s.toUpperCase()).join(" + ")}. Verificare compatibilità regimi e non duplicare dosi.` });
    }

    if (hasGenta && scs.filter(s => ["ivu", "pprom", "travaglio", "promTermine"].includes(s)).length > 1) {
      allAlerts.push({ type: "danger", text: "⚠ Gentamicina in più regimi — NON sommare le dosi. Un unico dosaggio 5mg/kg/die con TDM" });
    }
    if (hasAmpi && scs.includes("pprom") && (scs.includes("travaglio") || scs.includes("promTermine"))) {
      allAlerts.push({ type: "info", text: "Ampicillina in latenza + IAP — se fase IV in corso (2g ogni 6h), copre GIA il GBS. Non duplicare" });
    }
    if (hasNitro && data.eg >= 36) {
      if (!allAlerts.some(a => a.text.includes("38 settimane"))) {
        allAlerts.push({ type: "danger", text: "Nitrofurantoina a ≥36s — switch a cefalexina entro 38 settimane" });
      }
    }
    if (hasClinda && scs.filter(s => ["pprom", "travaglio", "cervicovaginale"].includes(s)).length > 1) {
      allAlerts.push({ type: "warning", text: "Clindamicina in più contesti — dosaggio: 300mg OS per BV vs 900mg IV per IAP. NON sovrapporli" });
    }
    if (scs.includes("ivu") && scs.includes("pprom")) {
      allAlerts.push({ type: "info", text: "IVU + pPROM: la latenza NON sostituisce il trattamento mirato dell'IVU. Completare entrambi" });
    }

    return { diagnosi: allDiagnosi, protocollo: allProtocollo, alerts: allAlerts, monitoraggio: allMonitoraggio, fonti: [...allFonti] };
  }, [showResult, data]);

  const canGenerate = data.scenarios.length > 0 && data.eg;

  const [page, setPage] = useState("generator");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState(null);

  const handleSmartSearch = useCallback((query) => {
    if (!query.trim()) { setSearchResult(null); return; }
    const parsed = parseSmartQuery(query);
    if (parsed.scenarios.length === 0 && Object.keys(parsed.fields).length === 0) {
      setSearchResult({ interpreted: ["❓ Nessuno scenario riconosciuto. Prova con: 'cistite 30 settimane allergia penicillina' o 'pPROM 28s GBS ignoto'"], scenarios: [], fields: {} });
      return;
    }
    setSearchResult(parsed);
  }, []);

  const applySearch = useCallback(() => {
    if (!searchResult || searchResult.scenarios.length === 0) return;
    setData(prev => {
      const newData = { ...prev };
      // Set scenarios
      newData.scenarios = searchResult.scenarios;
      newData.scenario = searchResult.scenarios[0];
      // Apply all parsed fields
      for (const [key, value] of Object.entries(searchResult.fields)) {
        newData[key] = value;
      }
      return newData;
    });
    setShowResult(true);
    setPage("generator");
    setSearchQuery("");
    setSearchResult(null);
  }, [searchResult]);

  // ═══ CONDITIONAL RENDER: LOGIN or MAIN APP ═══
  if (!user) {
    return (
      <div style={{ fontFamily: "'Segoe UI', sans-serif", maxWidth: 440, margin: "60px auto", padding: "0 16px" }}>
        <div style={{ background: "white", borderRadius: 14, padding: "32px 28px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: "1px solid #E0E0E0" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>💊</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1A3C5E", letterSpacing: 0.3 }}>Antibiotici in Gravidanza</div>
            <div style={{ fontSize: 12, color: "#7F8C8D", marginTop: 4 }}>Guida Clinica · Clinica Ostetrica · Univ. Bari</div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1A3C5E", marginBottom: 4 }}>Nome</label>
            <input type="text" value={loginForm.nome} onChange={e => setLoginForm(p => ({ ...p, nome: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Mario"
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #D5DBDB", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1A3C5E", marginBottom: 4 }}>Cognome</label>
            <input type="text" value={loginForm.cognome} onChange={e => setLoginForm(p => ({ ...p, cognome: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Rossi"
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #D5DBDB", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1A3C5E", marginBottom: 4 }}>Codice di Accesso</label>
            <input type="password" value={loginForm.codice} onChange={e => setLoginForm(p => ({ ...p, codice: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Inserisci il codice fornito"
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #D5DBDB", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box", letterSpacing: 2 }} />
          </div>
          {loginError && (
            <div style={{ background: "#FDEDEC", color: "#C0392B", padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, marginBottom: 14, textAlign: "center" }}>
              {loginError}
            </div>
          )}
          <button onClick={handleLogin}
            style={{ width: "100%", padding: "12px", background: "linear-gradient(135deg, #1A3C5E, #0E7C6B)", color: "white",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>
            Accedi
          </button>
          <div style={{ textAlign: "center", fontSize: 10, color: "#BDC3C7", marginTop: 16 }}>
            Developed by G.M. Baldini · DIM · University of Bari "Aldo Moro"
          </div>
        </div>
      </div>
    );
  }

  // ═══ MAIN APP (authenticated) ═══
  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif", maxWidth: 780, margin: "0 auto", padding: "0 8px 20px" }}>
      <div style={{ background: "linear-gradient(135deg, #1A3C5E, #0E7C6B)", color: "white", padding: "14px 18px", borderRadius: "0 0 12px 12px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.5 }}>Antibiotici in Gravidanza</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>Guida Clinica · Clinica Ostetrica · Univ. Bari</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <select value={page} onChange={e => setPage(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.15)", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", maxWidth: 200 }}>
              <option value="generator" style={{color:"#1A3C5E"}}>🧮 Protocollo Personalizzato</option>
              <option value="protocols" style={{color:"#1A3C5E"}}>📋 Protocolli per Scenario</option>
              <option value="formulary" style={{color:"#1A3C5E"}}>💊 Prontuario Farmaceutico</option>
              <option value="safety" style={{color:"#1A3C5E"}}>🛡️ Sicurezza per Trimestre</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
          <div style={{ fontSize: 11, opacity: 0.9 }}>
            <span style={{ marginRight: 4 }}>👤</span>
            <strong>Dott. {user.fullName}</strong>
          </div>
          <button onClick={handleLogout}
            style={{ padding: "3px 10px", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 5, color: "rgba(255,255,255,0.8)", fontSize: 10, cursor: "pointer" }}>
            Esci
          </button>
        </div>
      </div>

      {/* ═══ SMART CLINICAL SEARCH ═══ */}
      <div style={{ background: "white", borderRadius: 10, padding: "10px 14px", marginBottom: 10, border: "1.5px solid #D5DBDB" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); handleSmartSearch(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter" && searchResult?.scenarios?.length > 0) applySearch(); }}
            placeholder="Ricerca clinica intelligente — es: 'cistite 30 settimane allergia penicillina' o 'pPROM 28s GBS ignoto febbre 38.5'"
            style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #E0E0E0", borderRadius: 8, fontSize: 13, color: "#2C3E50", outline: "none", background: "#FAFBFC" }}
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(""); setSearchResult(null); }}
              style={{ padding: "6px 10px", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#95A5A6" }}>✕</button>
          )}
        </div>
        {searchResult && searchResult.interpreted.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {searchResult.interpreted.map((item, i) => (
                <span key={i} style={{
                  display: "inline-block", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: item.startsWith("❓") ? "#FDEDEC" : item.startsWith("⚠") ? "#FEF9E7" : item.startsWith("📋") ? "#F0F4F8" : item.startsWith("  →") ? "#EBF5FB" : "#E8F6F3",
                  color: item.startsWith("❓") ? "#C0392B" : item.startsWith("⚠") ? "#E67E22" : "#0E7C6B",
                }}>{item}</span>
              ))}
            </div>
            {searchResult.scenarios.length > 0 && (
              <button onClick={applySearch}
                style={{ width: "100%", padding: "10px", background: "linear-gradient(135deg, #0E7C6B, #1A3C5E)", color: "white",
                  border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 0.3 }}>
                ⚡ Applica e genera protocollo — {searchResult.scenarios.map(s => SCENARIOS_INPUT.find(x => x.id === s)?.icon || "").join(" ")} Premi Invio
              </button>
            )}
            {searchResult.scenarios.length === 0 && !searchResult.interpreted.some(i => i.startsWith("❓")) && (
              <div style={{ fontSize: 11, color: "#95A5A6", textAlign: "center", padding: 4 }}>
                Aggiungi uno scenario clinico per generare il protocollo (es: 'cistite', 'pPROM', 'travaglio')
              </div>
            )}
          </div>
        )}
        {!searchResult && !searchQuery && (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {["Cistite 30s", "pPROM 28s GBS ignoto", "PROM 39s rottura 20h", "Travaglio 38s GBS+ allergia penicillina alto", "Colica renale 33s pionefrosi", "Candidosi 20s"].map(ex => (
              <button key={ex} onClick={() => { setSearchQuery(ex); handleSmartSearch(ex); }}
                style={{ padding: "4px 10px", borderRadius: 15, border: "1px solid #E0E0E0", background: "#FAFBFC",
                  fontSize: 10, color: "#7F8C8D", cursor: "pointer" }}>
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ═══ REFERENCE PAGES ═══ */}
      {page === "protocols" && <ProtocolCards />}
      {page === "formulary" && <Formulary />}
      {page === "safety" && <SafetyTable />}

      {/* ═══ GENERATOR (original) ═══ */}
      {page === "generator" && <div>

      {/* ═══ SCENARIO + EG ═══ */}
      <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 4 }}>📌 Scenari Clinici <span style={{ fontSize: 11, fontWeight: 400, color: "#7F8C8D" }}>(selezione multipla — clicca tutti quelli applicabili)</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {SCENARIOS_INPUT.map(s => {
            const active = data.scenarios.includes(s.id);
            return (
            <button key={s.id} onClick={() => toggleScenario(s.id)}
              style={{ padding: "10px 8px", border: `2px solid ${active ? "#0E7C6B" : "#E0E0E0"}`,
                borderRadius: 8, cursor: "pointer", textAlign: "left", fontSize: 12, fontWeight: active ? 700 : 400,
                background: active ? "#E8F6F3" : "white", color: "#1A3C5E", position: "relative" }}>
              {active && <span style={{ position: "absolute", top: 4, right: 6, fontSize: 14, color: "#0E7C6B" }}>✓</span>}
              {s.icon} {s.label}
            </button>
          );})}
        </div>
        {data.scenarios.length > 1 && (
          <div style={{ marginTop: 6, padding: "6px 10px", background: "#FEF9E7", borderRadius: 6, fontSize: 11, color: "#E67E22" }}>
            ⚡ {data.scenarios.length} scenari selezionati — il protocollo combinerà le terapie con verifica interazioni
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <InputField label="Epoca gestazionale (settimane)" hint="Es: 28, 34.5, 39">
            <NumberInput value={data.eg} onChange={v => update("eg", v)} placeholder="Es: 32" min={16} max={42} step={0.5} />
          </InputField>
        </div>
      </div>

      {/* ═══ ALLERGIE (box unico) + ANTROPOMETRIA ═══ */}
      <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 8 }}>💊 Allergie Farmacologiche</div>
        <div style={{ background: "#F8F9FA", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="radio" name="allStato" checked={data.allergie?.stato === "nessuna"} onChange={() => update("allergie", { stato: "nessuna" })} />
              <strong>Nessuna allergia nota</strong>
            </label>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="radio" name="allStato" checked={data.allergie?.stato === "non_noto"} onChange={() => update("allergie", { stato: "non_noto" })} />
              <strong>Stato allergico non noto</strong>
            </label>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, gridColumn: "span 2" }}>
              <input type="radio" name="allStato" checked={data.allergie?.stato === "presente"} onChange={() => update("allergie", { stato: "presente" })} />
              <strong>Allergie presenti — seleziona classi sotto:</strong>
            </label>
          </div>
          {data.allergie?.stato === "presente" && (
            <div style={{ borderTop: "1px solid #E0E0E0", paddingTop: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {[
                  { key: "penicilline", label: "Penicilline (amox, ampicillina)", hasSeverity: true },
                  { key: "cefalosporine", label: "Cefalosporine (cefalexina, ceftriaxone)" },
                  { key: "carbapenemi", label: "Carbapenemi (ertapenem, meropenem)" },
                  { key: "macrolidi", label: "Macrolidi (azitromicina, eritromicina)" },
                  { key: "clindamicina", label: "Clindamicina (Dalacin®)" },
                  { key: "metronidazolo", label: "Metronidazolo (Flagyl®)" },
                  { key: "fluorochinoloni", label: "Fluorochinoloni (ciprofloxacina)" },
                  { key: "sulfonamidi", label: "Sulfonamidi (TMP-SMX, Bactrim®)" },
                  { key: "aminoglicosidi", label: "Aminoglicosidi (gentamicina)" },
                  { key: "nitrofurantoina", label: "Nitrofurantoina (Neofuradantin®)" },
                  { key: "glicopeptidi", label: "Glicopeptidi (vancomicina)" },
                ].map(item => (
                  <div key={item.key}>
                    <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" checked={!!data.allergie?.[item.key]}
                        onChange={e => update("allergie", { ...data.allergie, [item.key]: e.target.checked ? (item.hasSeverity ? "basso" : true) : false })} />
                      {item.label}
                    </label>
                    {item.hasSeverity && data.allergie?.[item.key] && (
                      <div style={{ marginLeft: 20, marginTop: 2 }}>
                        <select value={data.allergie[item.key]} onChange={e => update("allergie", { ...data.allergie, [item.key]: e.target.value })}
                          style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #D5DBDB", borderRadius: 4 }}>
                          <option value="basso">Basso rischio (rash, orticaria)</option>
                          <option value="alto">Alto rischio (anafilassi, angioedema)</option>
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 6 }}>📏 Dati Antropometrici</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <InputField label="Peso materno (kg)" hint="Per dosaggio weight-based vancomicina, cefazolina">
            <NumberInput value={data.pesoKg} onChange={v => update("pesoKg", v)} placeholder="70" min={30} max={200} />
          </InputField>
          <InputField label="Creatinina sierica (mg/dL)" hint="Normale in gravidanza: 0,4-0,8 mg/dL">
            <NumberInput value={data.creatinina} onChange={v => update("creatinina", v)} placeholder="0.6" min={0.1} max={10} step={0.1} />
          </InputField>
        </div>

        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 6 }}>📋 Anamnesi Ostetrica</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {[
            ["precedenteNeonatoGBS", "Precedente neonato con malattia GBS"],
            ["gbsPrecedenteGrav", "GBS+ in gravidanza precedente"],
            ["precedentePTB", "Precedente parto pretermine"],
            ["batteriuriaGBS", "Batteriuria GBS in gravidanza attuale"],
            ["ivuRicorrenti", "IVU ricorrenti in questa gravidanza (≥2)"],
            ["g6pd", "Deficit G6PD"],
            ["cerchiaggio", "Cerchiaggio cervicale in situ"],
            ["tcElettivoMI", "TC elettivo programmato (membrane integre)"],
          ].map(([key, label]) => (
            <label key={key} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={data[key]} onChange={e => update(key, e.target.checked)} /> {label}
            </label>
          ))}
        </div>
      </div>

      {/* ═══ PARAMETRI VITALI ═══ */}
      <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 8 }}>🌡️ Parametri Vitali (se disponibili)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <InputField label="Temperatura (°C)">
            <NumberInput value={data.temperatura} onChange={v => update("temperatura", v)} placeholder="37.2" min={35} max={42} step={0.1} />
          </InputField>
          <InputField label="FC materna (bpm)">
            <NumberInput value={data.fcMaterna} onChange={v => update("fcMaterna", v)} placeholder="80" />
          </InputField>
          <InputField label="FC fetale (bpm)">
            <NumberInput value={data.fcFetale} onChange={v => update("fcFetale", v)} placeholder="140" />
          </InputField>
        </div>
        {data.temperatura >= 38 && data.temperatura < 39 && (
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
            <input type="checkbox" checked={data.tempPersistente} onChange={e => update("tempPersistente", e.target.checked)} />
            Temperatura persistente ≥30 minuti (dopo rimisurazione)
          </label>
        )}
      </div>

      {/* ═══ LABORATORIO ═══ */}
      <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 8 }}>🧪 Laboratorio (se disponibile)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <InputField label="Globuli bianchi (WBC /mm³)" hint="Normale in gravidanza: fino a 12-15.000">
            <NumberInput value={data.wbc} onChange={v => update("wbc", v)} placeholder="12000" />
          </InputField>
          <InputField label="PCR (mg/L)">
            <NumberInput value={data.crp} onChange={v => update("crp", v)} placeholder="5" step={0.1} />
          </InputField>
        </div>
      </div>

      {/* ═══ MICROBIOLOGIA ═══ */}
      <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 8 }}>🦠 Microbiologia</div>

        <InputField label="Tampone vagino-rettale GBS">
          <Select value={data.gbsStatus} onChange={v => update("gbsStatus", v)}
            options={[{ value: "positivo", label: "Positivo" }, { value: "negativo", label: "Negativo" }, { value: "ignoto", label: "Non disponibile / Non eseguito" }]} />
        </InputField>

        {data.scenarios.includes("cervicovaginale") && (
          <>
            <InputField label="Tampone cervicovaginale disponibile?">
              <Select value={data.tamponeDisponibile} onChange={v => update("tamponeDisponibile", v)}
                options={[{ value: "si", label: "Sì — risultato disponibile" }, { value: "in_attesa", label: "Eseguito, in attesa di risultato" }, { value: "no", label: "Non eseguito / Non disponibile" }]} />
            </InputField>

            {data.tamponeDisponibile === "si" && (
              <>
                <InputField label="Patogeno isolato al tampone cervicovaginale">
                  <Select value={data.tamponeCVResult} onChange={v => update("tamponeCVResult", v)}
                    options={PATHOGENS.map(p => ({ value: p.id, label: p.label }))} />
                </InputField>
                {data.tamponeCVResult && (
                  <CVSwabInput label="Antibiogramma tampone CV (clicca S/I/R)" value={data.tamponeCV_ABG} onChange={v => update("tamponeCV_ABG", v)} />
                )}
              </>
            )}

            {(data.tamponeDisponibile === "no" || data.tamponeDisponibile === "in_attesa") && (
              <InputField label="Pattern sintomatologico (per terapia empirica)" hint="Seleziona il quadro clinico più simile">
                <Select value={data.sintomiVaginaliDettaglio} onChange={v => update("sintomiVaginaliDettaglio", v)}
                  options={[
                    { value: "asintomatica", label: "Asintomatica / Riscontro incidentale" },
                    { value: "prurito_cagliata", label: "Prurito + perdite biancastre a cagliata (sospetta candidosi)" },
                    { value: "odore_grigiastre", label: "Odore di pesce + perdite grigiastre omogenee (sospetta BV)" },
                    { value: "gialloverdastre_maleodoranti", label: "Perdite giallo-verdastre schiumose (sospetta Trichomonas)" },
                    { value: "cervicite_mucopurulenta", label: "Cervicite mucopurulenta + fattori rischio STI (sospetta CT/NG)" },
                    { value: "mista_aspecifica", label: "Sintomi misti / aspecifici (prurito + perdite + odore)" },
                  ]} />
              </InputField>
            )}
          </>
        )}

        {/* Sensibilità clindamicina GBS — visibile SOLO quando GBS POSITIVO */}
        {data.gbsStatus === "positivo" && (
          <InputField label="Antibiogramma GBS: sensibilità alla Clindamicina" hint="⚠ CRUCIALE se allergia a penicilline: determina se usare Dalacin® (clinda S) o Vancotex® (clinda R). ACOG CO #797: richiedere SEMPRE antibiogramma con clindamicina quando si isola GBS">
            <Select value={data.tamponeCV_ABG?.clindamicina || null} onChange={v => update("tamponeCV_ABG", { ...data.tamponeCV_ABG, clindamicina: v })}
              options={[
                { value: "S", label: "Sensibile (S) → Dalacin® disponibile come alternativa IAP" },
                { value: "R", label: "Resistente (R) → Vancotex® necessaria se allergia alto rischio" },
                { value: "non_testata", label: "Non testata / Non disponibile → ACOG raccomanda vancomicina per precauzione" },
              ]} />
          </InputField>
        )}

        <InputField label="Sintomi vaginali">
          <Select value={data.sintomiVaginali} onChange={v => update("sintomiVaginali", v)}
            options={[{ value: "no", label: "Assenti" }, { value: "si", label: "Presenti (prurito, perdite, bruciore)" }, { value: "scolo_purulento", label: "Scolo cervicale purulento" }]} />
        </InputField>

        {data.scenarios.includes("ivu") && (
          <>
            <InputField label="Urinocoltura" hint="Germe isolato (es: E. coli, Klebsiella, GBS...)">
              <Select value={data.urocoltura} onChange={v => update("urocoltura", v)}
                options={[{ value: "negativa", label: "Negativa / Sterile" }, { value: "E. coli", label: "E. coli" }, { value: "Klebsiella", label: "Klebsiella spp." },
                  { value: "Proteus", label: "Proteus spp." }, { value: "GBS", label: "Streptococcus agalactiae (GBS)" },
                  { value: "Enterococcus", label: "Enterococcus spp." }, { value: "altro", label: "Altro germe" }]} />
            </InputField>
            {data.urocoltura && data.urocoltura !== "negativa" && (
              <ABGInput label="Antibiogramma urinocoltura (clicca S/I/R per ogni farmaco)" value={data.uroABG} onChange={v => update("uroABG", v)} />
            )}
            <InputField label="Sintomi urinari">
              <Select value={data.sintomiUrinari} onChange={v => update("sintomiUrinari", v)}
                options={[{ value: "no", label: "Assenti (batteriuria asintomatica)" }, { value: "si", label: "Disuria, pollachiuria (cistite)" }, { value: "pielo", label: "Dolore lombare, febbre, brividi (pielonefrite)" }]} />
            </InputField>
          </>
        )}

        {data.scenarios.includes("pprom") && (
          <InputField label="Fase della gestione pPROM" hint={
            data.antibioticiInCorso === "si_latenza" 
              ? `💡 Stai facendo latenza${data.abxInCorsoGiorni ? ` (giorno ${data.abxInCorsoGiorni})` : ""}: seleziona se sei in conservativa o in travaglio`
              : data.antibioticiInCorso === "no" 
              ? "💡 Nessun antibiotico in corso: se in travaglio, probabilmente la latenza è completata"
              : "Determina se servono antibiotici di latenza, IAP GBS, o entrambi"
          }>
            <Select value={data.fasePprom} onChange={v => update("fasePprom", v)}
              options={[
                { value: "conservativa", label: "Gestione conservativa — inizio/in corso latenza antibiotica" },
                { value: "travaglio_esordio", label: "In TRAVAGLIO — pPROM appena diagnosticata, antibiotici NON ancora iniziati" },
                { value: "travaglio_in_latenza", label: "In TRAVAGLIO — durante la fase IV della latenza (antibiotici IV in corso)" },
                { value: "travaglio_in_latenza_os", label: "In TRAVAGLIO — durante la fase OS della latenza (gg 3-7, antibiotici orali)" },
                { value: "travaglio_post_latenza", label: "In TRAVAGLIO — dopo completamento latenza (antibiotici sospesi)" },
              ]} />
          </InputField>
        )}

        {(data.scenarios.includes("pprom") || data.scenarios.includes("promTermine") || data.scenarios.includes("travaglio")) && (
          <>
            <InputField label="Stato membrane">
              <Select value={data.membraneStatus} onChange={v => update("membraneStatus", v)}
                options={[{ value: "integre", label: "Integre" }, { value: "rotte_pretermine", label: "Rotte pretermine (pPROM)" }, { value: "rotte_termine", label: "Rotte a termine (PROM)" }]} />
            </InputField>
            {(data.membraneStatus === "rotte_pretermine" || data.membraneStatus === "rotte_termine") && (
              <InputField label="Ore dalla rottura delle membrane" hint="Soglia 18h per IAP empirica con GBS ignoto (ACOG CO #797)">
                <NumberInput value={data.oreRottura} onChange={v => update("oreRottura", v)} placeholder="Es: 6" min={0} max={500} step={0.5} />
              </InputField>
            )}
          </>
        )}
      </div>

      {/* ═══ SCENARIO-SPECIFIC: Incompetenza Cervicale ═══ */}
      {data.scenarios.includes("incompCervicale") && (
        <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 8 }}>🔓 Dati Specifici — Incompetenza Cervicale</div>
          <InputField label="Sotto-scenario clinico" hint="Determina il protocollo di gestione">
            <Select value={data.sottoscenarioIC} onChange={v => update("sottoscenarioIC", v)}
              options={[
                { value: "screening_ic", label: "Cervice corta/dilatata — screening e gestione conservativa (senza cerchiaggio)" },
                { value: "sacco_vagina", label: "Sacco amniotico in vagina (prolasso membrane)" },
                { value: "cerchiaggio_altrove", label: "Cerchiaggio posizionato altrove — paziente con sospetta infezione" },
              ]} />
          </InputField>
          <InputField label="Dilatazione cervicale (cm)" hint="Misurata ecograficamente o all'esplorazione. ≥2cm → considerare amniocentesi diagnostica">
            <NumberInput value={data.dilatazioneCervicale} onChange={v => update("dilatazioneCervicale", v)} placeholder="2" min={0} max={10} step={0.5} />
          </InputField>
          {data.sottoscenarioIC === "sacco_vagina" && (
            <>
              <InputField label="Stato delle membrane" hint="⚠ CRUCIALE: la gestione antibiotica cambia RADICALMENTE. Verificare SEMPRE con test oggettivi (nitrazina, ferning, IGFBP-1/Amnisure®, ecografia LA)">
                <Select value={data.membraneStatus} onChange={v => update("membraneStatus", v)}
                  options={[
                    { value: "integre", label: "INTEGRE — test negativi, LA nella norma (prolasso senza rottura)" },
                    { value: "rotte_pretermine", label: "ROTTE — pPROM confermata (test positivi e/o anidramnios)" },
                    { value: "non_verificato", label: "Non ancora verificato — test in corso" },
                  ]} />
              </InputField>
              {(!data.membraneStatus || data.membraneStatus === "non_verificato") && (
                <div style={{ background: "#FDEDEC", borderLeft: "4px solid #C0392B", padding: "8px 10px", borderRadius: 4, fontSize: 11, marginTop: 4, marginBottom: 8 }}>
                  🚫 NON iniziare antibiotici empirici tipo pPROM fino a conferma dello stato delle membrane. Eseguire SUBITO: nitrazina + ferning + IGFBP-1 + ecografia LA
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ SCENARIO-SPECIFIC: Colica Renale / Pielectasia ═══ */}
      {data.scenarios.includes("colicaRenale") && (
        <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 8 }}>💎 Dati Specifici — Apparato Urinario</div>
          <InputField label="Quadro clinico">
            <Select value={data.doloreColica} onChange={v => update("doloreColica", v)}
              options={[
                { value: "pielectasia", label: "Pielectasia isolata (riscontro ecografico)" },
                { value: "colica_semplice", label: "Colica renale senza segni di infezione" },
                { value: "colica_febbre", label: "Colica renale + febbre / segni di infezione" },
                { value: "pionefrosi", label: "Pionefrosi / ascesso renale" },
                { value: "litiasi_ostruttiva", label: "Litiasi ostruttiva documentata (eco/RM)" },
              ]} />
          </InputField>
          <InputField label="Idronefrosi ecografica">
            <Select value={data.idronefrosiGrado} onChange={v => update("idronefrosiGrado", v)}
              options={[
                { value: "assente", label: "Assente" },
                { value: "lieve_dx", label: "Lieve — destra (fisiologica in gravidanza)" },
                { value: "moderata", label: "Moderata" },
                { value: "severa", label: "Severa / con calice dilatato" },
              ]} />
          </InputField>
          <InputField label="Urinocoltura" hint="L'infezione urinaria e l'ostruzione si potenziano a vicenda. L'urinocoltura è OBBLIGATORIA in qualsiasi quadro urologico in gravidanza">
            <Select value={data.urocoltura} onChange={v => update("urocoltura", v)}
              options={[
                { value: "negativa", label: "Negativa / sterile" },
                { value: "in_attesa", label: "In attesa del risultato" },
                { value: "E. coli", label: "E. coli" },
                { value: "Klebsiella", label: "Klebsiella" },
                { value: "Proteus", label: "Proteus" },
                { value: "Enterococcus", label: "Enterococcus" },
                { value: "GBS", label: "Streptococco gruppo B (GBS)" },
                { value: "Staph_sapro", label: "S. saprophyticus" },
                { value: "altro", label: "Altro germe" },
              ]} />
          </InputField>
          {data.urocoltura && data.urocoltura !== "negativa" && data.urocoltura !== "in_attesa" && (
            <ABGInput label="Antibiogramma urinocoltura" value={data.uroABG} onChange={v => update("uroABG", v)} />
          )}
        </div>
      )}

      {/* ═══ ANAMNESI FARMACOLOGICA ═══ */}
      <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 8 }}>💉 Terapia Antibiotica in Corso</div>
        <InputField label="La paziente sta attualmente assumendo antibiotici?" hint="Fondamentale per evitare duplicazioni e adattare il protocollo">
          <Select value={data.antibioticiInCorso} onChange={v => update("antibioticiInCorso", v)}
            options={[
              { value: "no", label: "No — nessun antibiotico in corso" },
              { value: "si_latenza", label: "Sì — antibiotici di LATENZA per pPROM" },
              { value: "si_ivu", label: "Sì — in trattamento per IVU/pielonefrite" },
              { value: "si_profilassi", label: "Sì — profilassi (soppressiva IVU, IAP GBS...)" },
              { value: "si_altro", label: "Sì — altro motivo (infezione respiratoria, ferita...)" },
            ]} />
        </InputField>
        {data.antibioticiInCorso && data.antibioticiInCorso !== "no" && (
          <>
            <InputField label="Quale antibiotico? (nome commerciale o principio attivo)" hint="Es: Amplital®, Rocefin®, Zimox®, Dalacin®...">
              <input type="text" value={data.abxInCorsoNome || ""} onChange={e => update("abxInCorsoNome", e.target.value)}
                placeholder="Es: Amplital 2g IV ogni 6h" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #D5DBDB", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
            </InputField>
            <InputField label="Da quanti giorni?" hint="Per valutare se la latenza è in fase IV (gg 1-2) o OS (gg 3-7) o completata">
              <NumberInput value={data.abxInCorsoGiorni} onChange={v => update("abxInCorsoGiorni", v)} placeholder="Es: 3" min={0} max={30} />
            </InputField>
          </>
        )}
      </div>

      {/* ═══ EMOCOLTURE ═══ */}
      <div style={{ background: "white", borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid #E0E0E0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A3C5E", marginBottom: 8 }}>🩸 Emocolture</div>
        <InputField label="Emocolture eseguite?">
          <Select value={data.emocoltura} onChange={v => update("emocoltura", v)}
            options={[
              { value: "non_eseguita", label: "Non eseguite" },
              { value: "in_attesa", label: "Eseguite — in attesa di risultato" },
              { value: "negativa", label: "Negative (no crescita a 48-72h)" },
              { value: "positiva", label: "POSITIVE — germe isolato" },
            ]} />
        </InputField>
        {data.emocoltura === "positiva" && (
          <InputField label="Germe isolato all'emocoltura" hint="Es: E. coli, S. aureus, GBS, Enterococcus...">
            <input type="text" value={data.emocolturaGerme || ""} onChange={e => update("emocolturaGerme", e.target.value)}
              placeholder="Es: E. coli ESBL+" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #D5DBDB", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
          </InputField>
        )}
        {(data.temperatura >= 38 || (data.wbc && data.wbc > 15000)) && (!data.emocoltura || data.emocoltura === "non_eseguita") && (
          <div style={{ background: "#FDEDEC", borderLeft: "4px solid #C0392B", padding: "6px 10px", borderRadius: 4, fontSize: 11, marginTop: 4 }}>
            🚫 Febbre e/o leucocitosi presenti — RICHIEDERE EMOCOLTURE (almeno 2 set da siti diversi) PRIMA di iniziare antibiotici se possibile
          </div>
        )}
      </div>

      {/* ═══ GENERA ═══ */}
      <button onClick={() => setShowResult(true)} disabled={!canGenerate}
        style={{ width: "100%", padding: "14px", background: canGenerate ? "linear-gradient(135deg, #0E7C6B, #1A3C5E)" : "#BDC3C7",
          color: "white", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: canGenerate ? "pointer" : "not-allowed",
          marginBottom: 8, letterSpacing: 1 }}>
        {canGenerate ? "GENERA PROTOCOLLO TERAPEUTICO" : "Seleziona almeno uno scenario e inserisci EG"}
      </button>

      {!canGenerate && <div style={{ textAlign: "center", fontSize: 11, color: "#95A5A6" }}>Compila almeno: scenario clinico + epoca gestazionale</div>}

      {/* ═══ RESULTS ═══ */}
      {results && <ResultView results={results} patientData={data} user={user} />}

      <div style={{ textAlign: "center", fontSize: 9, color: "#BDC3C7", marginTop: 16 }}>
        Strumento di supporto decisionale — NON sostituisce il giudizio clinico · Developed by G.M. Baldini · Univ. Bari
      </div>
      </div>}
    </div>
  );
}
