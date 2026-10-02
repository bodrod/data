const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

async function fetchWithRetry(url, options = {}, retries = 3, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, ...options });
      if (res.ok) return res;

      if (res.status === 401 || res.status === 429 || res.status >= 500) {
        console.warn(`⚠️ HTTP ${res.status} en ${url}. Enfriando (${delay / 1000}s)... [Intento ${i + 1}/${retries}]`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`⚠️ Error de conexión: ${err.message}. Reintentando...`);
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error(`No se pudo obtener respuesta para ${url}`);
}

async function syncCategory(categoryId, categoryName, fileName) {
  console.log(`\n----------------------------------------`);
  console.log(`Iniciando sincronización: ${categoryName} (ID: ${categoryId})`);
  console.log(`----------------------------------------`);

  const filePath = path.join(dataDir, fileName);

  try {
    const groupsRes = await fetchWithRetry(`https://tcgcsv.com/tcgplayer/${categoryId}/groups`);
    const groupsData = await groupsRes.json();
    const groups = groupsData.results || [];

    if (groups.length === 0) {
      console.error(`❌ No se encontraron grupos para ${categoryName}.`);
      return;
    }

    console.log(`Obtenidos ${groups.length} grupos para ${categoryName}.`);
    let allCards = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      console.log(`[${i + 1}/${groups.length}] ${categoryName} - Set: ${group.name}...`);

      try {
        await sleep(350); // Pausa responsable entre colecciones

        // Peticiones secuenciales para evitar bloqueos por tasa de transferencia
        const prodRes = await fetchWithRetry(`https://tcgcsv.com/tcgplayer/${categoryId}/${group.groupId}/products`);
        const productsData = await prodRes.json();

        await sleep(150);

        const priceRes = await fetchWithRetry(`https://tcgcsv.com/tcgplayer/${categoryId}/${group.groupId}/prices`);
        const pricesData = await priceRes.json();

        const products = productsData.results || [];
        const prices = pricesData.results || [];

        for (let p of products) {
          const rarityObj = (p.extendedData || []).find(e => e.name === "Rarity");
          const numObj = (p.extendedData || []).find(e => e.name === "Number");

          const prodPrices = prices.filter(pr => pr.productId === p.productId);
          let marketPrice = null;
          for (let pr of prodPrices) {
            if (pr.marketPrice && pr.marketPrice > 0) {
              marketPrice = pr.marketPrice;
              break;
            } else if (pr.midPrice && pr.midPrice > 0) {
              marketPrice = pr.midPrice;
              break;
            }
          }

          let url = p.url || `https://www.tcgplayer.com/product/${p.productId}`;
          if (url && !url.startsWith('http')) url = 'https://www.tcgplayer.com' + url;

          allCards.push({
            id: p.productId,
            name: p.cleanName || p.name,
            set: group.name,
            number: numObj ? String(numObj.value) : '',
            rarity: rarityObj ? rarityObj.value : 'N/A',
            price: marketPrice,
            url: url,
            image: p.imageUrl || ''
          });
        }
      } catch (groupErr) {
        console.warn(`⚠️ Omitiendo set "${group.name}": ${groupErr.message}`);
      }
    }

    if (allCards.length > 0) {
      fs.writeFileSync(filePath, JSON.stringify(allCards, null, 2));
      console.log(`✅ ${categoryName} guardado con éxito: ${allCards.length} cartas.`);
    } else {
      console.error(`⚠️ Advertencia: No se extrajeron cartas para ${categoryName}.`);
    }

  } catch (err) {
    console.error(`❌ Error general en ${categoryName}: ${err.message}`);
  }
}

async function main() {
  try {
    await syncCategory(3, "Pokémon TCG", "pokemon.json");
    console.log("\nPausa de 8 segundos antes de One Piece TCG...");
    await sleep(8000);
    await syncCategory(68, "One Piece TCG", "onepiece.json");
    console.log("\n🎉 Sincronización finalizada correctamente.");
  } catch (e) {
    console.error("Error en ejecución principal:", e);
  }
}

main();
