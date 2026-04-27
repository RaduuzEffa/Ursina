const { createApp, ref, computed, onMounted, nextTick, toRaw } = Vue;

const App = {
  setup() {
    // UI State
    const isDraggingPrimary = ref(false);
    const isDraggingSecondary = ref(false);
    const isProcessing = ref(false);
    
    // Primary Source
    const primaryFile = ref(null);
    const primaryInput = ref(null);
    const primaryColumns = ref([]);
    const selectedPrimaryKey = ref("");
    const primaryEntities = ref([]); // for PDF/Word
    const primaryData = ref([]); // for Excel/CSV

    // Secondary Source
    const sourceType = ref('file'); // 'file' nebo 'search'
    const secondaryFile = ref(null);
    const secondaryInput = ref(null);
    const searchUrl = ref("");
    
    const secondaryColumns = ref([]);
    const secondaryData = ref([]); 
    const secondaryKey = ref("");
    const secondarySelectedExtractCols = ref([]); // Zvolené sloupce k přidání
    const secondaryUnstructuredText = ref("");

    // Možnosti extrakce z textu/URL
    const extractOptions = ref({
      email: true,
      phone: true,
      address: false
    });

    // Progress a výsledky
    const progress = ref(0);
    const progressStatus = ref("");
    const results = ref([]);
    const resultHeaders = ref([]);

    // Computed validation
    const validationStatus = computed(() => {
      if (!primaryFile.value) return { ok: false, msg: "Nahrajte první dokument." };
      if (primaryData.value.length > 0 && !selectedPrimaryKey.value) return { ok: false, msg: "Vyberte sloupec v prvním dokumentu, podle kterého se bude vyhledávat." };
      if (primaryData.value.length === 0 && primaryEntities.value.length === 0) return { ok: false, msg: "Z prvního dokumentu se nepodařilo vyčíst data k hledání." };
      
      if (sourceType.value === 'file') {
        if (!secondaryFile.value && !secondaryUnstructuredText.value) return { ok: false, msg: "Nahrajte databázi kontaktů." };
        if (secondaryData.value.length > 0) {
          if (!secondaryKey.value) return { ok: false, msg: "Vyberte sloupec v databázi, který se má spárovat s prvním dokumentem." };
          if (secondarySelectedExtractCols.value.length === 0) return { ok: false, msg: "Vyberte alespoň jeden sloupec z databáze, který chcete přidat." };
        }
      } else if (sourceType.value === 'search') {
        if (!searchUrl.value.includes('{NAME}')) return { ok: false, msg: "Vyhledávací URL musí obsahovat značku {NAME}." };
        if (!extractOptions.value.email && !extractOptions.value.phone && !extractOptions.value.address) {
           return { ok: false, msg: "Zaškrtněte alespoň jeden údaj (E-mail, Telefon, Adresa) pro extrakci." };
        }
      } else if (sourceType.value === 'text') {
        if (!secondaryUnstructuredText.value) return { ok: false, msg: "Vložte text do připraveného pole." };
        if (!extractOptions.value.email && !extractOptions.value.phone && !extractOptions.value.address) {
           return { ok: false, msg: "Zaškrtněte alespoň jeden údaj (E-mail, Telefon, Adresa) pro extrakci." };
        }
      }

      return { ok: true, msg: "Připraveno ke spuštění" };
    });

    const triggerFileInput = (refName) => {
      const el = refName === 'primaryInput' ? primaryInput.value : secondaryInput.value;
      if (el) el.click();
    };

    const formatSize = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const resetApp = () => {
      primaryFile.value = null;
      primaryColumns.value = [];
      selectedPrimaryKey.value = "";
      primaryEntities.value = [];
      primaryData.value = [];
      
      secondaryFile.value = null;
      secondaryData.value = [];
      secondaryColumns.value = [];
      secondaryKey.value = "";
      secondarySelectedExtractCols.value = [];
      secondaryUnstructuredText.value = "";
      
      results.value = [];
      resultHeaders.value = [];
      progress.value = 0;
      progressStatus.value = "";
    };

    const processPrimaryFile = async (file) => {
      primaryFile.value = file;
      const ext = file.name.split('.').pop().toLowerCase();
      results.value = [];
      resultHeaders.value = [];
      
      try {
        if (['xlsx', 'csv'].includes(ext)) {
          await parseExcel(file, 'primary');
        } else if (ext === 'pdf') {
          await parsePDF(file, 'primary');
        } else if (ext === 'docx') {
          await parseDocx(file, 'primary');
        } else {
          throw new Error('Nepodporovaný formát primárního souboru.');
        }
      } catch (err) {
        console.error(err);
        alert('Chyba při čtení prvního souboru: ' + err.message);
        primaryFile.value = null;
      }
    };

    const processSecondaryFile = async (file) => {
      secondaryFile.value = file;
      const ext = file.name.split('.').pop().toLowerCase();
      secondaryData.value = [];
      secondaryColumns.value = [];
      secondaryUnstructuredText.value = "";
      secondarySelectedExtractCols.value = [];
      
      try {
        if (['xlsx', 'csv'].includes(ext)) {
          await parseExcel(file, 'secondary');
        } else if (ext === 'pdf') {
          secondaryUnstructuredText.value = await extractTextFromPDF(file);
        } else if (ext === 'docx') {
          secondaryUnstructuredText.value = await extractTextFromDocx(file);
        } else if (ext === 'txt') {
          secondaryUnstructuredText.value = await file.text();
        } else {
          throw new Error('Sekundární zdroj musí být Excel, CSV, PDF, DOCX nebo TXT.');
        }
      } catch (err) {
        console.error(err);
        alert('Chyba při čtení druhého souboru: ' + err.message);
        secondaryFile.value = null;
      }
    };

    const parseExcel = (file, target) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "" });
            
            if (json.length === 0) throw new Error('Soubor je prázdný');
            const cols = Object.keys(json[0]);
            
            if (target === 'primary') {
              primaryData.value = json;
              primaryColumns.value = cols;
              // Guess key
              const guessedKey = cols.find(c => c.toLowerCase().includes('jméno') || c.toLowerCase().includes('name') || c.toLowerCase().includes('ič') || c.toLowerCase().includes('firma') || c.toLowerCase().includes('subjekt'));
              if (guessedKey) selectedPrimaryKey.value = guessedKey;
            } else {
              secondaryData.value = json;
              secondaryColumns.value = cols;
              // Guess key for secondary
              const guessedKey = cols.find(c => c.toLowerCase().includes('jméno') || c.toLowerCase().includes('name') || c.toLowerCase().includes('ič') || c.toLowerCase().includes('firma') || c.toLowerCase().includes('subjekt'));
              if (guessedKey) secondaryKey.value = guessedKey;
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
      });
    };

    const extractTextFromPDF = async (file) => {
      if (!window['pdfjs-dist/build/pdf']) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(" ") + "\n";
      }
      return fullText;
    };

    const extractTextFromDocx = async (file) => {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      return result.value;
    };

    const parsePDF = async (file, target) => {
      const text = await extractTextFromPDF(file);
      if (target === 'primary') extractEntitiesFromText(text);
    };

    const parseDocx = async (file, target) => {
      const text = await extractTextFromDocx(file);
      if (target === 'primary') extractEntitiesFromText(text);
    };

    const extractEntitiesFromText = (text) => {
      const nameRegex = /([A-ZĚŠČŘŽÝÁÍÉÚŮŤĎŇ][a-zěščřžýáíéúůťďň]+\s+[A-ZĚŠČŘŽÝÁÍÉÚŮŤĎŇ][a-zěščřžýáíéúůťďň]+)/g;
      const matches = [...new Set(text.match(nameRegex) || [])];
      primaryEntities.value = matches.filter(n => n.length > 5 && n.length < 50);
      primaryData.value = []; // Znamená, že je to text
    };

    const extractRegex = (text, type) => {
       if (type === 'email') {
          const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          return m ? m[0] : "";
       }
       if (type === 'phone') {
          const m = text.match(/(?:\+420)?\s*[0-9]{3}\s*[0-9]{3}\s*[0-9]{3}/);
          return m ? m[0].trim() : "";
       }
       if (type === 'address') {
          // Velmi základní odhad české adresy (hledá PSČ a kousek textu kolem)
          const m = text.match(/[A-ZĚŠČŘŽÝÁÍÉÚŮŤĎŇ][^\n,]+,\s*\d{3}\s*\d{2}\s+[A-ZĚŠČŘŽÝÁÍÉÚŮŤĎŇ][a-zěščřžýáíéúůťďň]+/);
          return m ? m[0] : "";
       }
       return "";
    };

    const runAnalysis = async () => {
      if (!validationStatus.value.ok) {
        alert(validationStatus.value.msg);
        return;
      }

      isProcessing.value = true;
      progress.value = 0;
      progressStatus.value = "Analyzuji a páruji data...";
      results.value = [];
      resultHeaders.value = [];

      try {
        const isTabularPrimary = primaryData.value.length > 0;
        const total = isTabularPrimary ? primaryData.value.length : primaryEntities.value.length;
        const batchSize = Math.max(1, Math.floor(total / 100));
        
        const isSearch = sourceType.value === 'search';
        const isUnstructuredSecondary = !isSearch && secondaryUnstructuredText.value.length > 0 && secondaryData.value.length === 0;
        
        let fuse = null;
        let secondaryMap = new Map();
        let unstructuredTextLower = "";

        if (isUnstructuredSecondary) {
          unstructuredTextLower = secondaryUnstructuredText.value.toLowerCase();
        } else if (!isSearch) {
          // Excel to Excel - Build Exact Match Map
          const rawSecondaryData = toRaw(secondaryData.value);
          rawSecondaryData.forEach(row => {
            const keyVal = String(row[secondaryKey.value] || "").toLowerCase().trim();
            if (keyVal) {
              secondaryMap.set(keyVal, row);
            }
          });

          // Fallback to Fuse.js for fuzzy match
          const fuseOptions = { keys: [secondaryKey.value], threshold: 0.2, distance: 100 };
          fuse = new Fuse(rawSecondaryData, fuseOptions);
        }

        // Prepare base headers
        if (isTabularPrimary) {
           resultHeaders.value = [...primaryColumns.value];
        } else {
           resultHeaders.value = ["Hledané jméno"];
        }

        // Add dynamically extracted headers
        if (isSearch || isUnstructuredSecondary) {
           if (extractOptions.value.email) resultHeaders.value.push("Doplněný E-mail");
           if (extractOptions.value.phone) resultHeaders.value.push("Doplněný Telefon");
           if (extractOptions.value.address) resultHeaders.value.push("Doplněná Adresa");
        } else {
           secondarySelectedExtractCols.value.forEach(col => {
              if (!resultHeaders.value.includes(col)) resultHeaders.value.push("Doplněno: " + col);
           });
        }

        // Process rows
        for (let i = 0; i < total; i++) {
          const baseRow = isTabularPrimary ? primaryData.value[i] : { "Hledané jméno": primaryEntities.value[i] };
          const searchVal = isTabularPrimary ? baseRow[selectedPrimaryKey.value] : primaryEntities.value[i];
          
          let enrichedRow = { ...baseRow, __MATCHED__: false };

          if (!searchVal || String(searchVal).trim() === "") {
             results.value.push(enrichedRow);
             continue;
          }

          if (isSearch) {
            // 1. Způsob: Auto-hledání z internetové URL
            const targetUrl = searchUrl.value.replace('{NAME}', encodeURIComponent(searchVal));
            
            try {
              const response = await fetch(targetUrl);
              if (response.ok) {
                const html = await response.text();
                
                if (extractOptions.value.email) {
                   const em = extractRegex(html, 'email');
                   if (em) { enrichedRow["Doplněný E-mail"] = em; enrichedRow.__MATCHED__ = true; }
                }
                if (extractOptions.value.phone) {
                   const ph = extractRegex(html, 'phone');
                   if (ph) { enrichedRow["Doplněný Telefon"] = ph; enrichedRow.__MATCHED__ = true; }
                }
                if (extractOptions.value.address) {
                   const ad = extractRegex(html, 'address');
                   if (ad) { enrichedRow["Doplněná Adresa"] = ad; enrichedRow.__MATCHED__ = true; }
                }
              }
            } catch (err) {
              console.error("Chyba hledání pro:", searchVal, err);
            }
          } else if (isUnstructuredSecondary) {
            // UNSTRUCTURED TEXT FILE (PDF, DOCX, TXT)
            const searchIndex = unstructuredTextLower.indexOf(String(searchVal).toLowerCase());
            if (searchIndex !== -1) {
              const windowStr = secondaryUnstructuredText.value.substring(searchIndex, searchIndex + 200);
              if (extractOptions.value.email) {
                   const em = extractRegex(windowStr, 'email');
                   if (em) { enrichedRow["Doplněný E-mail"] = em; enrichedRow.__MATCHED__ = true; }
              }
              if (extractOptions.value.phone) {
                   const ph = extractRegex(windowStr, 'phone');
                   if (ph) { enrichedRow["Doplněný Telefon"] = ph; enrichedRow.__MATCHED__ = true; }
              }
              if (extractOptions.value.address) {
                   const ad = extractRegex(windowStr, 'address');
                   if (ad) { enrichedRow["Doplněná Adresa"] = ad; enrichedRow.__MATCHED__ = true; }
              }
            }
          } else {
            // STRUCTURED EXCEL TO EXCEL
            const searchStr = String(searchVal).toLowerCase().trim();
            let bestMatch = secondaryMap.get(searchStr);

            // Fallback to fuzzy match if exact match not found
            if (!bestMatch && fuse) {
              const searchResult = fuse.search(String(searchVal));
              if (searchResult.length > 0) {
                bestMatch = searchResult[0].item;
              }
            }

            if (bestMatch) {
              enrichedRow.__MATCHED__ = true;
              secondarySelectedExtractCols.value.forEach(col => {
                 enrichedRow["Doplněno: " + col] = bestMatch[col] || "";
              });
            }
          }

          results.value.push(enrichedRow);

          if (i % batchSize === 0 || i === total - 1) {
            progress.value = Math.round(((i + 1) / total) * 100);
            progressStatus.value = `Zpracováno: ${i+1} z ${total}`;
            await new Promise(r => setTimeout(r, 0));
          }
        }
        
        progressStatus.value = "Analýza dokončena!";
      } catch (err) {
        console.error(err);
        alert('Chyba při běhu procesu: ' + err.message);
      } finally {
        isProcessing.value = false;
      }
    };

    const saveResults = () => {
      try {
        const cleanData = results.value.map(row => {
           const { __MATCHED__, ...rest } = row;
           return rest;
        });

        const worksheet = XLSX.utils.json_to_sheet(cleanData, { header: resultHeaders.value });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Výsledek");
        
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const originalName = primaryFile.value.name.replace(/\.[^/.]+$/, "");
        const fileName = `${originalName}_obohaceno.xlsx`;

        // Automatically trigger download (more reliable across browsers)
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error(err);
        alert('Chyba při ukládání souboru: ' + err.message);
      }
    };

    onMounted(() => {
      nextTick(() => { lucide.createIcons(); });
    });

    Vue.watch(
      () => [primaryFile.value, secondaryFile.value, results.value, validationStatus.value],
      () => {
        nextTick(() => { lucide.createIcons(); });
      },
      { deep: true }
    );

    return {
      isDraggingPrimary, isDraggingSecondary, isProcessing,
      primaryFile, primaryColumns, selectedPrimaryKey, primaryEntities,
      sourceType, secondaryFile, searchUrl, secondaryColumns, secondaryKey, 
      secondarySelectedExtractCols, secondaryUnstructuredText, extractOptions,
      progress, progressStatus, results, resultHeaders, validationStatus,
      triggerFileInput, formatSize, resetApp,
      handlePrimaryDrop: (e) => { isDraggingPrimary.value=false; if(e.dataTransfer.files.length) processPrimaryFile(e.dataTransfer.files[0]); },
      handlePrimarySelect: (e) => { if(e.target.files.length) processPrimaryFile(e.target.files[0]); },
      handleSecondaryDrop: (e) => { isDraggingSecondary.value=false; if(e.dataTransfer.files.length) processSecondaryFile(e.dataTransfer.files[0]); },
      handleSecondarySelect: (e) => { if(e.target.files.length) processSecondaryFile(e.target.files[0]); },
      removePrimaryFile: () => { primaryFile.value = null; resetApp(); },
      removeSecondaryFile: () => { secondaryFile.value = null; secondaryData.value=[]; secondaryColumns.value=[]; secondaryUnstructuredText.value=""; secondarySelectedExtractCols.value=[]; },
      runAnalysis, saveResults, primaryInput, secondaryInput
    };
  }
};

createApp(App).mount('#app');
