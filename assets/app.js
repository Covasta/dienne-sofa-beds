(function () {
  const catalog = window.DIENNE_CATALOG || { products: [], assets: {} };
  const params = new URLSearchParams(window.location.search);
  const page = document.body.dataset.page;
  const query = (params.get("q") || "").trim();
  let appliedPriceFilter = { min: null, max: null };
  let appliedLengthFilter = { min: null, max: null };
  const listStateKey = "dienneListState";

  function formatPrice(value) {
    if (!value) return "";
    return "¥" + Number(value).toLocaleString("zh-CN");
  }

  function priceLabel(product) {
    const min = product.summary && product.summary.minPrice;
    const max = product.summary && product.summary.maxPrice;
    if (!min) return "";
    if (min === max || !max) return formatPrice(min);
    return formatPrice(min) + " - " + formatPrice(max);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function displayText(value) {
    const text = String(value ?? "").trim();
    if (["见原配置表", "见原始配置表", "见原始价格表"].includes(text)) return "";
    return escapeHtml(text);
  }

  function setupSearchForms() {
    document.querySelectorAll("[data-search-form]").forEach((form) => {
      const input = form.querySelector("input[name='q']");
      if (input && query) input.value = query;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = (input ? input.value : "").trim();
        const target = value ? "search.html?q=" + encodeURIComponent(value) : "index.html";
        window.location.href = target;
      });
    });
  }

  function activeFilters() {
    const series = Array.from(document.querySelectorAll("[data-filter-series]"))
      .filter((input) => input.checked)
      .map((input) => input.value);
    const stockOnly = Boolean(document.querySelector("[data-filter-stock]")?.checked);
    const robotOnly = Boolean(document.querySelector("[data-filter-robot]")?.checked);
    return {
      series,
      min: appliedPriceFilter.min,
      max: appliedPriceFilter.max,
      lengthMin: appliedLengthFilter.min,
      lengthMax: appliedLengthFilter.max,
      stockOnly,
      robotOnly,
    };
  }

  function saveListState(filters) {
    if (page !== "list" && page !== "search") return;

    const state = {
      url: window.location.href,
      series: filters.series,
      stockOnly: filters.stockOnly,
      robotOnly: filters.robotOnly,
      price: { min: filters.min, max: filters.max },
      length: { min: filters.lengthMin, max: filters.lengthMax },
      priceInputs: {
        min: document.querySelector("[data-price-min]")?.value || "",
        max: document.querySelector("[data-price-max]")?.value || "",
      },
      lengthInputs: {
        min: document.querySelector("[data-length-min]")?.value || "",
        max: document.querySelector("[data-length-max]")?.value || "",
      },
    };
    window.sessionStorage.setItem(listStateKey, JSON.stringify(state));
  }

  function restoreListState() {
    if (page !== "list" && page !== "search") return;

    let state = null;
    try {
      state = JSON.parse(window.sessionStorage.getItem(listStateKey) || "null");
    } catch (error) {
      state = null;
    }
    if (!state || state.url !== window.location.href) return;

    document.querySelectorAll("[data-filter-series]").forEach((input) => {
      input.checked = (state.series || []).includes(input.value);
    });
    const stockInput = document.querySelector("[data-filter-stock]");
    const robotInput = document.querySelector("[data-filter-robot]");
    if (stockInput) stockInput.checked = Boolean(state.stockOnly);
    if (robotInput) robotInput.checked = Boolean(state.robotOnly);

    appliedPriceFilter = state.price || { min: null, max: null };
    appliedLengthFilter = state.length || { min: null, max: null };

    const priceMin = document.querySelector("[data-price-min]");
    const priceMax = document.querySelector("[data-price-max]");
    const lengthMin = document.querySelector("[data-length-min]");
    const lengthMax = document.querySelector("[data-length-max]");
    if (priceMin) priceMin.value = state.priceInputs?.min || "";
    if (priceMax) priceMax.value = state.priceInputs?.max || "";
    if (lengthMin) lengthMin.value = state.lengthInputs?.min || "";
    if (lengthMax) lengthMax.value = state.lengthInputs?.max || "";
  }

  function matchesSearch(product) {
    if (!query) return true;
    const q = query.toLowerCase();
    const normalized = q.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
    const searchText = String(product.searchText || "").toLowerCase();
    const numeric = /^\d+$/.test(q);

    if (numeric) {
      return (product.summary.lengths || []).some((length) => String(length) === q) || searchText.includes(q);
    }
    return searchText.includes(q) || searchText.includes(normalized);
  }

  function matchesFilters(product, filters) {
    if (!filters.series.includes(product.series)) return false;
    if (filters.stockOnly && !hasStock(product)) return false;
    if (filters.robotOnly && !product.robotFriendly) return false;

    if (filters.min !== null || filters.max !== null) {
      const minPrice = product.summary && product.summary.minPrice;
      const maxPrice = product.summary && product.summary.maxPrice;
      if (!minPrice || !maxPrice) return false;
      const minLimit = filters.min === null ? Number.NEGATIVE_INFINITY : filters.min;
      const maxLimit = filters.max === null ? Number.POSITIVE_INFINITY : filters.max;
      if (!(maxPrice >= minLimit && minPrice <= maxLimit)) return false;
    }

    if (filters.lengthMin === null && filters.lengthMax === null) return true;
    const lengths = ((product.summary && product.summary.lengths) || [])
      .map((length) => Number(length))
      .filter((length) => Number.isFinite(length));
    if (!lengths.length) return false;
    const lengthMinLimit = filters.lengthMin === null ? Number.NEGATIVE_INFINITY : filters.lengthMin;
    const lengthMaxLimit = filters.lengthMax === null ? Number.POSITIVE_INFINITY : filters.lengthMax;
    return lengths.some((length) => length >= lengthMinLimit && length <= lengthMaxLimit);
  }

  function hasStock(product) {
    return (product.variants || []).some((variant) => Number(variant.stock || 0) > 0);
  }

  function renderCards(products) {
    const grid = document.querySelector("[data-product-grid]");
    const empty = document.querySelector("[data-empty]");
    const count = document.querySelector("[data-result-count]");
    const title = document.querySelector("[data-result-title]");
    if (!grid) return;

    if (page === "search" && title) {
      title.textContent = query ? `“${query}” 的搜索结果` : "搜索结果";
    }

    grid.innerHTML = products
      .map(
        (product) => {
          const price = priceLabel(product);
          return `
          <article class="product-card">
            <a class="product-card__image" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="${escapeHtml(product.name)}">
              <img src="${escapeHtml(product.images.thumb)}" alt="${escapeHtml(product.name)}" loading="lazy" />
            </a>
            <div class="product-card__body">
              <div class="product-card__series">${escapeHtml(product.seriesLabel)}</div>
              <h2><a href="product.html?id=${encodeURIComponent(product.id)}">${escapeHtml(product.name)}</a></h2>
              <div class="product-card__meta">
                ${price ? `<span class="pill pill--price">${escapeHtml(price)}</span>` : ""}
                ${
                  hasStock(product)
                    ? '<span class="pill pill--accent">现货</span>'
                    : ""
                }
                ${
                  product.robotFriendly
                    ? '<span class="tag-break" aria-hidden="true"></span><span class="pill pill--accent pill--full">扫地机器人可进出</span>'
                    : ""
                }
              </div>
            </div>
          </article>
        `;
        }
      )
      .join("");

    if (count) count.textContent = `${products.length} 件产品`;
    if (empty) empty.hidden = products.length !== 0;
  }

  function updateList() {
    const filters = activeFilters();
    const products = catalog.products
      .filter(matchesSearch)
      .filter((product) => matchesFilters(product, filters));
    renderCards(products);
    saveListState(filters);
  }

  function setupFloatingBack() {
    if (page !== "product" && page !== "faq") return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "floating-back";
    button.textContent = "返回";
    button.setAttribute("aria-label", "返回上一页");
    button.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }

      let fallback = "index.html";
      try {
        const state = JSON.parse(window.sessionStorage.getItem(listStateKey) || "null");
        if (state && state.url) fallback = state.url;
      } catch (error) {
        fallback = "index.html";
      }
      window.location.href = fallback;
    });
    document.body.appendChild(button);
  }

  function setupFilters() {
    document
      .querySelectorAll("[data-filter-series], [data-filter-stock], [data-filter-robot]")
      .forEach((control) => {
        control.addEventListener("input", updateList);
        control.addEventListener("change", updateList);
      });

    const minInput = document.querySelector("[data-price-min]");
    const maxInput = document.querySelector("[data-price-max]");
    const applyButton = document.querySelector("[data-price-apply]");
    const clearButton = document.querySelector("[data-price-clear]");
    const lengthMinInput = document.querySelector("[data-length-min]");
    const lengthMaxInput = document.querySelector("[data-length-max]");
    const lengthApplyButton = document.querySelector("[data-length-apply]");
    const lengthClearButton = document.querySelector("[data-length-clear]");
    const readRange = (startInput, endInput) => {
      const startValue = startInput && startInput.value !== "" ? Number(startInput.value) : null;
      const endValue = endInput && endInput.value !== "" ? Number(endInput.value) : null;
      let min = Number.isFinite(startValue) ? startValue : null;
      let max = Number.isFinite(endValue) ? endValue : null;
      if (min !== null && max !== null && min > max) {
        const originalMin = min;
        min = max;
        max = originalMin;
      }
      return { min, max };
    };
    const applyPrice = () => {
      appliedPriceFilter = readRange(minInput, maxInput);
      updateList();
    };
    const applyLength = () => {
      appliedLengthFilter = readRange(lengthMinInput, lengthMaxInput);
      updateList();
    };

    applyButton?.addEventListener("click", applyPrice);
    clearButton?.addEventListener("click", () => {
      if (minInput) minInput.value = "";
      if (maxInput) maxInput.value = "";
      appliedPriceFilter = { min: null, max: null };
      updateList();
    });
    lengthApplyButton?.addEventListener("click", applyLength);
    lengthClearButton?.addEventListener("click", () => {
      if (lengthMinInput) lengthMinInput.value = "";
      if (lengthMaxInput) lengthMaxInput.value = "";
      appliedLengthFilter = { min: null, max: null };
      updateList();
    });
    [minInput, maxInput].forEach((input) => {
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyPrice();
      });
    });
    [lengthMinInput, lengthMaxInput].forEach((input) => {
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyLength();
      });
    });
  }

  function shortText(text, fallback) {
    const clean = String(text || "").trim();
    return clean || fallback;
  }

  function dimensions(product) {
    const variants = product.variants || [];
    const values = variants
      .map((variant) => {
        if (!variant.length || !variant.width || !variant.height) return "";
        return `${variant.length} × ${variant.width} × ${variant.height} cm`;
      })
      .filter(Boolean);
    return Array.from(new Set(values)).join(" / ") || "";
  }

  function codes(product) {
    const codeList = product.summary && product.summary.codes;
    return codeList && codeList.length ? codeList.join(" / ") : "";
  }

  function variantsTable(product) {
    const variants = product.variants || [];
    if (!variants.length) {
      return `<p class="config-text">暂无现货库存。</p>`;
    }

    return `
      <table class="variant-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>尺寸</th>
            <th>床垫</th>
            <th>面料</th>
            <th>价格</th>
            <th>库存</th>
          </tr>
        </thead>
        <tbody>
          ${variants
            .map(
              (variant) => `
                <tr>
                  <td>${displayText(variant.code || variant.number)}</td>
                  <td>${displayText(
                    variant.length && variant.width && variant.height
                      ? `${variant.length} × ${variant.width} × ${variant.height} cm`
                      : "见原始配置表"
                  )}</td>
                  <td>${displayText(resolvedMattress(product, variant))}</td>
                  <td>${displayText(variant.description || "见原始配置表")}</td>
                  <td>${displayText(formatPrice(variant.retailPrice))}</td>
                  <td>${displayText(variant.stock ?? "见原始配置表")}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function compactSize(value) {
    return String(value || "")
      .replace(/[×xX]/g, "×")
      .replace(/\s+/g, "")
      .replace(/cm$/i, "");
  }

  function variantSofaSize(variant) {
    if (!variant.length || !variant.width || !variant.height) return "";
    return `${variant.length}×${variant.width}×${variant.height}`;
  }

  function compactCode(value) {
    return String(value || "").replace(/[^0-9]/g, "");
  }

  function resolvedMattress(product, variant) {
    if (variant.mattress) return variant.mattress;
    if (product.name === "Coupè & Clever" && compactCode(variant.code) === "3000") {
      return "80×190×16（2）";
    }

    const target = compactSize(variantSofaSize(variant));
    const styles = product.productStyles || [];

    const match = styles.find((style) => compactSize(style.sofaSize) === target)
      || styles.find((style) => compactCode(style.code) && compactCode(style.code) === compactCode(variant.code));
    return match && match.mattressSize ? match.mattressSize : "";
  }

  function stylePrice(row, label, fallbackIndex) {
    const prices = row.prices || [];
    const matched = prices.find((price) => String(price.label || "").includes(label));
    if (matched) return displayText(formatPrice(matched.value));

    const hasFabricLabels = prices.some((price) => {
      const priceLabelText = String(price.label || "");
      return priceLabelText.includes("\u5e38\u89c4\u9762\u6599") || priceLabelText.includes("\u9ad8\u7ea7\u9762\u6599");
    });
    if (hasFabricLabels) return "";

    return prices[fallbackIndex] ? displayText(formatPrice(prices[fallbackIndex].value)) : "";
  }

  function productStylesTable(product) {
    const styles = product.productStyles || [];
    if (!styles.length) {
      return `<p class="config-text">暂无产品款式信息。</p>`;
    }

    return `
      <table class="style-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>沙发尺寸</th>
            <th>床垫尺寸</th>
            <th>常规面料价格</th>
            <th>高级面料价格</th>
          </tr>
        </thead>
        <tbody>
          ${styles
            .map(
              (row) => `
                <tr>
                  <td>${displayText(row.code)}</td>
                  <td>${displayText(row.sofaSize)}</td>
                  <td>${displayText(row.mattressSize)}</td>
                  <td>${stylePrice(row, "\u5e38\u89c4\u9762\u6599", 0)}</td>
                  <td>${stylePrice(row, "\u9ad8\u7ea7\u9762\u6599", 1)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function productDetailImages(product) {
    const detailImages = (product.images && product.images.details) || [];
    if (!detailImages.length) return "";

    return `
      <section class="detail-section product-page-gallery">
        <h2>产品详情</h2>
        ${detailImages
          .map(
            (src, index) => `
              <img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)} 产品详情第 ${index + 1} 页" loading="lazy" />
            `
          )
          .join("")}
      </section>
    `;
  }

  function stockImagesSection(product) {
    const stockImages = product.stockImages || [];
    if (!stockImages.length) return "";

    return `
      <section class="detail-section stock-gallery">
        <h2>现货图片</h2>
        <div class="stock-gallery__grid">
          ${stockImages
            .map(
              (image) => `
                <figure>
                  <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.label || product.name)}" loading="lazy" />
                  <figcaption>${escapeHtml(image.label || product.name)}</figcaption>
                </figure>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderProductDetail() {
    const container = document.querySelector("[data-product-detail]");
    if (!container) return;

    const id = params.get("id");
    const product = catalog.products.find((item) => item.id === id);
    if (!product) {
      container.innerHTML = `
        <section class="product-detail">
          <p class="eyebrow">Dienne Sofa Bed</p>
          <h1>未找到产品</h1>
          <p class="config-text">请从产品目录重新选择。</p>
        </section>
      `;
      return;
    }

    document.title = `${product.name} - Dienne 沙发床`;
    const badges = [
      hasStock(product) ? '<span class="pill pill--accent">现货</span>' : "",
      product.robotFriendly ? '<span class="pill pill--accent">扫地机器人可进出</span>' : "",
    ].join("");

    container.innerHTML = `
      <section class="product-detail">
        <div class="detail-hero">
          <div class="detail-hero__image">
            <img src="${escapeHtml(product.images.hero)}" alt="${escapeHtml(product.name)}" />
          </div>
          <div class="detail-copy">
            <p class="eyebrow">${escapeHtml(product.seriesLabel)}</p>
            <h1>${escapeHtml(product.name)}</h1>
            <div class="detail-price">${escapeHtml(priceLabel(product))}</div>
            <div class="detail-badges">${badges}</div>
          </div>
        </div>

        ${productDetailImages(product)}

        <section class="detail-section">
          <h2>产品款式</h2>
          ${productStylesTable(product)}
        </section>

        <section class="detail-section">
          <h2>现货库存</h2>
          ${variantsTable(product)}
        </section>

        ${stockImagesSection(product)}
      </section>
    `;
  }

  function init() {
    setupSearchForms();
    setupFloatingBack();
    if (page === "product") {
      renderProductDetail();
    } else {
      setupFilters();
      restoreListState();
      updateList();
    }
  }

  init();
})();
