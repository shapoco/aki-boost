// ==UserScript==
// @name        Aki Boost
// @namespace   https://github.com/shapoco/aki-boost/raw/refs/heads/main/dist/
// @updateURL   https://github.com/shapoco/aki-boost/raw/refs/heads/main/dist/aki-boost.user.js
// @downloadURL https://github.com/shapoco/aki-boost/raw/refs/heads/main/dist/aki-boost.user.js
// @match       https://akizukidenshi.com/*
// @match       https://www.akizukidenshi.com/*
// @version     1.0.452
// @author      Shapoco
// @description 秋月電子の購入履歴を記憶して商品ページに購入日を表示します。
// @run-at      document-start
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM_info
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG_MODE = false;

  const APP_NAME = 'Aki Boost';
  const SETTING_KEY = 'akibst_settings';
  const NAME_KEY_PREFIX = 'akibst-partname-'; // TDDO: 削除
  const LINK_TITLE = `${APP_NAME} が作成したリンク`;

  const QUANTITY_UNKNOWN = -1;
  const CART_ITEM_LIFE_TIME = 7 * 86400 * 1000;

  const PARAGRAPH_MARGIN = '10px';

  const COLOR_LIGHT_HISTORY = '#def';
  const COLOR_DARK_HISTORY = '#06c';
  const COLOR_LIGHT_IN_CART = '#fde';
  const COLOR_DARK_IN_CART = '#e0b';

  class AkiBoost {
    constructor() {
      /** @type {Database} */
      this.db = new Database();
      this.menuOpenButton = document.createElement('button');
      this.menuWindow = createWindow(`${APP_NAME} (v${GM_info.script.version})`, '250px');
      this.debugMenuDiv = document.createElement('div');
      this.databaseInfoLabel = document.createElement('span');
      this.isLoggedIn = false;
    }

    async start() {
      this.checkLoginState();

      await this.loadDatabase();

      this.setupMenuWindow();

      if (window.location.href.startsWith('https://akizukidenshi.com/catalog/customer/history.aspx')) {
        await this.scanHistory(document);
      }
      else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/customer/historydetail.aspx')) {
        await this.scanHistoryDetail(document);
      }
      else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/cart/cart.aspx')) {
        await this.scanCart(document);
      }
      else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/g/')) {
        await this.fixItemPage(document);
      }
      else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/')) {
        await this.fixCatalog(document);
      }

      await this.saveDatabase();
    }

    checkLoginState() {
      this.isLoggedIn =
        !!Array.from(document.querySelectorAll('img'))
          .find(img => img.alt == 'マイページ');
    }

    // MARK: メニュー
    setupMenuWindow() {
      this.menuOpenButton.textContent = `⚙ ${APP_NAME}`;
      this.menuOpenButton.style.writingMode = 'vertical-rl';
      this.menuOpenButton.style.position = 'fixed';
      this.menuOpenButton.style.left = '0px';
      this.menuOpenButton.style.bottom = '100px';
      this.menuOpenButton.style.zIndex = '10000';
      this.menuOpenButton.style.padding = '10px 5px';
      this.menuOpenButton.style.backgroundColor = COLOR_DARK_HISTORY;
      this.menuOpenButton.style.borderStyle = 'none';
      this.menuOpenButton.style.borderRadius = '0 5px 5px 0';
      this.menuOpenButton.style.color = '#fff';
      this.menuOpenButton.style.fontSize = '12px';
      this.menuOpenButton.style.cursor = 'pointer';
      document.body.appendChild(this.menuOpenButton);

      this.menuWindow.style.position = 'fixed';
      this.menuWindow.style.left = '40px';
      this.menuWindow.style.bottom = '100px';

      this.menuWindow.appendChild(wrapWithParagraph(this.databaseInfoLabel));
      this.updateDatabaseInfo();

      const learnButton = createButton('📃➜📦 購入履歴を更新', '100%');
      this.menuWindow.appendChild(wrapWithParagraph(learnButton));
      if (!this.isLoggedIn) {
        learnButton.disabled = true;
        this.menuWindow.appendChild(wrapWithParagraph(
          '購入履歴を更新する前に <a href="https://akizukidenshi.com/catalog/customer/menu.aspx">ログイン</a> してください。'));
      }

      const cartHistoryButton = createButton('📦➜🛒 最近カートに入れた商品', '100%');
      this.menuWindow.appendChild(wrapWithParagraph(cartHistoryButton));

      const resetButton = createButton('📦➜🗑️ データベースをリセット', '100%');
      this.menuWindow.appendChild(wrapWithParagraph(resetButton));

      this.debugMenuDiv.appendChild(document.createElement('hr'));
      this.debugMenuDiv.appendChild(wrapWithParagraph('デバッグ用機能:'));

      const exportButton = createButton('📦➜📋 JSON にエクスポート', '100%');
      this.debugMenuDiv.appendChild(wrapWithParagraph(exportButton));

      const importButton = createButton('📋➜📦 JSON からインポート', '100%');
      this.debugMenuDiv.appendChild(wrapWithParagraph(importButton));

      const debugStatus = wrapWithParagraph('');
      this.debugMenuDiv.appendChild(debugStatus);

      this.debugMenuDiv.style.display = 'none';
      this.menuWindow.appendChild(this.debugMenuDiv);

      this.menuOpenButton.addEventListener('click', (e) => {
        if (this.menuWindow.parentNode) {
          this.menuWindow.remove();
        }
        else {
          this.updateDatabaseInfo();
          this.debugMenuDiv.style.display = e.shiftKey ? 'block' : 'none';
          document.body.appendChild(this.menuWindow);
        }
      });

      resetButton.addEventListener('click', async () => {
        if (confirm('データベースをリセットしますか？')) {
          this.db = new Database();
          await this.saveDatabase();
          this.updateDatabaseInfo();
        }
      });

      learnButton.addEventListener('click', async () => {
        this.menuWindow.remove();
        await this.openUpdateHistoryWindow();
      });

      cartHistoryButton.addEventListener('click', async () => {
        this.menuWindow.remove();
        await this.openCartHistoryTool();
      });

      exportButton.addEventListener('click', async () => {
        try {
          this.cleanupDatabase();
          await navigator.clipboard.writeText(JSON.stringify(this.db));
          debugStatus.textContent = 'クリップボードにコピーしました。';
        }
        catch (e) {
          debugError(e);
          debugStatus.textContent = 'クリップボードへのコピーに失敗しました。';
        }
      });

      importButton.addEventListener('click', async () => {
        try {
          if (!confirm('データベースを復元しますか？\n【注意！】現在のデータベースの内容は失われます。')) return
          const json = await navigator.clipboard.readText();
          this.db = new Database();
          this.db.loadFromJson(JSON.parse(json));
          await this.saveDatabase();
          this.updateDatabaseInfo();
          debugStatus.textContent = 'クリップボードからインポートしました。';
        }
        catch (e) {
          debugError(e);
          debugStatus.textContent = 'インポートに失敗しました。';
        }
      });
    }

    updateDatabaseInfo() {
      this.databaseInfoLabel.innerHTML =
        `記憶している注文情報: ${Object.keys(this.db.orders).length}件<br>` +
        `記憶している部品情報: ${Object.keys(this.db.parts).length}件<br>` +
        `カートのログ: ${Object.keys(this.db.cart).length}件`;
    }

    // MARK: 購入履歴の更新
    async openUpdateHistoryWindow() {
      this.menuOpenButton.disabled = true;

      await this.loadDatabase();

      const windowDiv = createWindow('購入履歴の更新', '300px');
      windowDiv.style.position = 'fixed';
      windowDiv.style.left = '50%';
      windowDiv.style.top = '50%';
      windowDiv.style.transform = 'translate(-50%, -50%)';

      const status = wrapWithParagraph('[開始] ボタンで更新を開始します。');
      windowDiv.appendChild(status);

      const progressBar = document.createElement('progress');
      progressBar.max = 100;
      progressBar.value = 0;
      progressBar.style.width = '100%';
      progressBar.style.opacity = '0.25';
      windowDiv.appendChild(wrapWithParagraph(progressBar));

      const startButton = createButton('開始', '80px');
      const closeButton = createButton('閉じる', '80px');
      const p = wrapWithParagraph([startButton, '\n', closeButton]);
      p.style.textAlign = 'center';
      windowDiv.appendChild(p);

      document.body.appendChild(windowDiv);

      const onClose = () => {
        if (windowDiv.parentNode) windowDiv.remove();
        this.menuOpenButton.disabled = false;
      };
      closeButton.addEventListener('click', onClose);
      windowDiv.closeBox.addEventListener('click', onClose);

      startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        closeButton.disabled = true;
        windowDiv.closeBox.disabled = true;
        progressBar.style.opacity = '1';
        await this.updateHistory(status, progressBar);
        closeButton.disabled = false;
        windowDiv.closeBox.disabled = false;
      });
    }

    // MARK: 購入履歴の更新
    async updateHistory(status, progressBar) {
      const unknownOrderIds = Object.keys(this.db.orders);

      try {
        const PAGE_STRIDE = DEBUG_MODE ? 5 : 100;

        status.textContent = `オーダー ID を列挙しています...`;
        let doc = await downloadHtml(`https://akizukidenshi.com/catalog/customer/history.aspx?ps=${PAGE_STRIDE}`);

        let numOrders = -1;

        // ページ数を推定
        const pagerCount = doc.querySelector('.pager-count');
        if (pagerCount) {
          const m = pagerCount.textContent.match(/\b(\d+)\s*件/);
          if (m) {
            numOrders = parseInt(m[1]);
          }
        }
        else {
          debugError('ページ数不明');
        }

        let orderIds = [];

        // オーダー ID を列挙
        while (true) {
          status.textContent = `オーダー ID を列挙しています... (${orderIds.length}/${numOrders > 0 ? numOrders : '?'})`;
          if (numOrders > 0) {
            progressBar.value = orderIds.length * 100 / numOrders;
          }

          // ページ内のオーダー ID を取得
          const tables = Array.from(doc.querySelectorAll('.block-purchase-history--table'));
          for (let table of tables) {
            const idUls = table.querySelector('.block-purchase-history--order-detail-list');
            orderIds.push(idUls.querySelector('a').textContent.trim());
          }

          // 次のページへ
          const pagerNext = doc.querySelector('.pager-next');
          if (!pagerNext) break;
          const nextLink = pagerNext.querySelector('a');
          if (!nextLink || nextLink.rel != 'next') break;
          doc = await downloadHtml(nextLink.href);
        }

        // オーダーID ごとに詳細を読み込む
        let numLoaded = 0;
        for (let i = 0; i < orderIds.length; i++) {
          const orderId = orderIds[i];
          if (!(orderId in this.db.orders) || !this.db.orders[orderId].isFilled()) {
            status.textContent = `購入履歴を更新しています... (${i + 1}/${orderIds.length})`;
            progressBar.value = i * 100 / orderIds.length;

            const doc = await downloadHtml(`https://akizukidenshi.com/catalog/customer/historydetail.aspx?order_id=${encodeURIComponent(orderId)}`);
            await this.scanHistoryDetail(doc);

            numLoaded++;
          }
          unknownOrderIds.splice(unknownOrderIds.indexOf(orderId), 1);
        }

        // 未知のオーダー ID を削除
        for (let orderId of unknownOrderIds) {
          debugLog(`未知の注文情報の削除: ${orderId}`);
          delete this.db.orders[orderId];
        }

        this.updateDatabaseInfo();
        await this.saveDatabase();

        if (numLoaded == 0) {
          status.textContent = '新しい購入履歴はありませんでした。';
        }
        else {
          status.textContent = `${numLoaded} 件の購入履歴が新たに読み込まれました。`;
        }
        progressBar.value = 100;
      }
      catch (e) {
        const msg = `⚠ 読み込みに失敗しました`;
        debugError(`${msg}: ${e}`);
        status.textContent = msg;
      }
    }

    // MARK: カート履歴の表示
    async openCartHistoryTool() {
      this.menuOpenButton.disabled = true;

      await this.loadDatabase();

      const windowDiv = createWindow('最近カートに入れた商品', '720px');
      windowDiv.style.position = 'fixed';
      windowDiv.style.left = '50%';
      windowDiv.style.top = '50%';
      windowDiv.style.transform = 'translate(-50%, -50%)';

      windowDiv.appendChild(wrapWithParagraph(
        '表示内容が古い場合は一旦 <a href="https://akizukidenshi.com/catalog/cart/cart.aspx" target="_blank">カート</a> を開いてからリロードしてみてください。'
      ));

      let checkBoxes = [];

      // 表の生成
      const table = createTable(
        ['操作', '通販コード', '商品名', '数量', '日時']
      );
      const tbody = table.querySelector('tbody');
      const cartItems = Object.values(this.db.cart);
      cartItems.sort((a, b) => b.timestamp - a.timestamp);
      for (let cartItem of cartItems) {
        let partName = cartItem.name;
        if (cartItem.code in this.db.parts) {
          const newName = this.db.parts[cartItem.code].getName();;
          if (newName) {
            cartItem.name = newName;
            partName = newName;
          }
        }

        // 選択用チェックボックス
        const checkBox = document.createElement('input');
        checkBox.type = 'checkbox';
        checkBox.dataset.partCode = cartItem.code;
        checkBox.dataset.quantity = cartItem.quantity;
        checkBoxes.push(checkBox);

        // 行の生成
        const tr = document.createElement('tr');
        tr.appendChild(createTableCell(checkBox, { textAlign: 'center' }));
        tr.appendChild(createTableCell(this.createPartCodeLink(cartItem.code), { textAlign: 'center' }));
        tr.appendChild(createTableCell(partName));
        tr.appendChild(createTableCell(cartItem.quantity, { textAlign: 'right', noWrap: true }));
        const timeTd = createTableCell(prettyTime(cartItem.timestamp), { textAlign: 'right', noWrap: true });
        timeTd.title = new Date(cartItem.timestamp).toLocaleString();
        tr.appendChild(timeTd);
        tbody.appendChild(tr);
      }

      table.style.width = '100%';
      table.style.margin = '0';
      const tableWrap = document.createElement('div');
      tableWrap.style.boxSizing = 'border-box';
      tableWrap.style.width = 'calc(100% - 20px)'; // こうしないと幅が合わない?
      tableWrap.style.maxHeight = '480px';
      tableWrap.style.overflowY = 'auto';
      tableWrap.style.margin = PARAGRAPH_MARGIN;
      tableWrap.style.padding = '0';
      tableWrap.appendChild(table);

      windowDiv.appendChild(tableWrap);

      const addToCartButton = createButton('チェックされた商品をカートに追加');

      const p = wrapWithParagraph(addToCartButton);
      p.style.textAlign = 'center';
      windowDiv.appendChild(p);

      document.body.appendChild(windowDiv);

      windowDiv.closeBox.addEventListener('click', () => {
        windowDiv.remove();
        this.menuOpenButton.disabled = false;
      });

      addToCartButton.addEventListener('click', async () => {
        // チェックされた商品をカートに追加
        let items = [];
        let totalQty = 0;
        for (let checkBox of checkBoxes) {
          if (checkBox.checked) {
            const code = checkBox.dataset.partCode;
            const quantity = parseInt(checkBox.dataset.quantity);
            items.push(`${encodeURIComponent(code)}+${quantity}`);
            totalQty += quantity;
          }
        }
        if (items.length > 0) {
          const url = `https://akizukidenshi.com/catalog/quickorder/blanketorder.aspx?regist_goods=${items.join('%0D%0A')}`;
          window.open(url, '_blank');
        }
        else {
          alert('商品がチェックされていません。');
        }
      });
    }

    // MARK: 購入履歴をスキャン
    async scanHistory(doc) {
      const tables = Array.from(doc.querySelectorAll('.block-purchase-history--table'));
      for (let table of tables) {
        const idUls = table.querySelector('.block-purchase-history--order-detail-list');

        const orderId = idUls.querySelector('a').textContent.trim();
        const time = parseDate(table.querySelector('.block-purchase-history--order_dt').textContent);
        let order = this.orderById(orderId, time);

        const itemDivs = Array.from(table.querySelectorAll('.block-purchase-history--goods-name'));
        for (let itemDiv of itemDivs) {
          // 部品情報の取得
          const partName = normalizePartName(itemDiv.textContent);

          // 通販コードを取得
          let code = order.partCodeFromName(partName);
          if (partName in this.db.partCodeDict) {
            code = this.db.partCodeDict[partName];
          }

          itemDiv.innerHTML = '';
          if (code) {
            const part = this.partByCode(code, partName);
            part.linkToOrder(orderId);
            order.linkToPart(code, partName);
            itemDiv.appendChild(this.createPartCodeLink(code));
          }
          else {
            // 通販コード不明
            const link = document.createElement('a');
            link.textContent = '(コード不明)';
            link.title = `データベースを更新してください。\n${LINK_TITLE}`;
            const keyword = partName.replace(/\s*\([^\)]+入り?\)\s*$/g, '');
            link.href = this.getPartSearchUrl(keyword);
            setBackgroundStyle(link, COLOR_LIGHT_HISTORY);
            itemDiv.appendChild(link);
          }
          itemDiv.appendChild(document.createTextNode(partName));
        }
      }
    }

    // MARK: 購入履歴詳細をスキャン
    async scanHistoryDetail(doc) {
      const orderId = doc.querySelector('.block-purchase-history-detail--order-id').textContent.trim();
      const time = parseDate(doc.querySelector('.block-purchase-history-detail--order-dt').textContent);
      const partTableTbody = doc.querySelector('.block-purchase-history-detail--order-detail-items tbody');
      const partRows = Array.from(partTableTbody.querySelectorAll('tr'));

      let order = this.orderById(orderId, time);

      for (let partRow of partRows) {
        const partCodeDiv = partRow.querySelector('.block-purchase-history-detail--goods-code');
        const partCode = partCodeDiv.textContent.trim();
        const partName = normalizePartName(partRow.querySelector('.block-purchase-history-detail--goods-name').textContent);
        const quantity = parseInt(partRow.querySelector('.block-purchase-history-detail--goods-qty').textContent.trim());
        if (!partCode) { debugError(`通販コードが見つかりません`); continue; }
        if (!partName) { debugError(`部品名が見つかりません`); continue; }
        if (quantity <= 0) { debugError(`数量が見つかりません`); continue; }

        // データベース更新
        let part = this.partByCode(partCode, partName);
        part.linkToOrder(orderId);
        order.linkToPart(partCode, partName, quantity);

        // ID にリンクを張る
        partCodeDiv.innerHTML = '';
        partCodeDiv.appendChild(this.createPartCodeLink(partCode));
      }
    }

    // 部品ページへのリンクを作成
    createPartCodeLink(code) {
      const link = document.createElement('a');
      link.textContent = code;
      link.href = `https://akizukidenshi.com/catalog/g/g${code}/`;

      const quantity = this.partQuantityInCart(code);
      if (quantity > 0) {
        setBackgroundStyle(link, COLOR_LIGHT_IN_CART);
        link.title = `カートに入っています (${quantity}個)\n${LINK_TITLE}`;
      }
      else {
        setBackgroundStyle(link, COLOR_LIGHT_HISTORY);
        link.title = LINK_TITLE;
      }

      return link;
    }

    // MARK: カートをスキャン
    async scanCart(doc) {
      const trs = Array.from(doc.querySelectorAll('.block-cart--goods-list'));
      let index = 1;
      // 一旦全ての商品をカートから外す
      for (const item of Object.values(this.db.cart)) {
        item.isInCart = false;
      }
      // 表示されている商品をカートに追加
      const now = new Date().getTime();
      for (const tr of trs) {
        const partCode = tr.querySelector('.js-enhanced-ecommerce-goods').textContent.trim();
        const partName = normalizePartName(tr.querySelector('.js-enhanced-ecommerce-goods-name').textContent);
        const quantity = parseInt(tr.querySelector(`input[name="qty${index}"]`).value);

        if (partCode in this.db.cart) {
          let item = this.db.cart[partCode];
          item.name = partName;
          item.quantity = quantity;
          item.isInCart = quantity > 0;
          item.timestamp = now;
        }
        else {
          this.db.cart[partCode] = new CartItem(partCode, partName, quantity, now);
        }

        // 通販コードに部品名を関連付け
        this.partByCode(partCode, partName);

        index++;
      }
    }

    // MARK: 商品ページを修正
    async fixItemPage(doc) {
      const code = doc.querySelector('#hidden_goods').value;
      const name = normalizePartName(doc.querySelector('#hidden_goods_name').value);
      const part = this.partByCode(code, name);

      const h1 = doc.querySelector('.block-goods-name--text');
      if (!h1) {
        debugError(`部品名が見つかりません`);
        return;
      }

      let elems = [];

      // 購入履歴を列挙
      for (let orderId of part.orderIds) {
        if (!(orderId in this.db.orders)) continue;
        const order = this.db.orders[orderId];
        const span = document.createElement('span');
        const link = document.createElement('a');
        link.href = `https://akizukidenshi.com/catalog/customer/historydetail.aspx?order_id=${orderId}`;
        link.textContent = new Date(order.timestamp).toLocaleDateString();
        link.title = LINK_TITLE;
        span.appendChild(link);
        if (code in order.items && order.items[code].quantity > 0) {
          span.appendChild(document.createTextNode(` (${order.items[code].quantity}個)`));
        }
        elems.push(span);
      }

      if (false) {
        const link = document.createElement('a');
        link.href = this.getHistorySearchUrl(part.name);
        link.textContent = "購入履歴から検索";
        link.title = LINK_TITLE;
        elems.push(link);
      }

      // カートに入っている商品の情報
      const qtyInCart = this.partQuantityInCart(code);
      if (qtyInCart > 0) {
        const link = document.createElement('a');
        link.href = this.getCartUrl(code);
        link.textContent = `カートに入っています (${qtyInCart}個)`;
        link.style.color = COLOR_DARK_IN_CART;
        elems.push(link);
      }

      const div = document.createElement('div');
      if (part.orderIds.length > 0) {
        div.appendChild(document.createTextNode('購入履歴: '));
      }
      for (let i = 0; i < elems.length; i++) {
        if (i > 0) div.appendChild(document.createTextNode(' | '));
        div.appendChild(elems[i]);
      }
      if (qtyInCart == 0) {
        setBackgroundStyle(div, COLOR_LIGHT_HISTORY);
      }
      else {
        setBackgroundStyle(div, COLOR_LIGHT_IN_CART);
      }
      h1.parentElement.appendChild(div);

      // 関連商品にも強調表示を適用する
      const itemDivs = Array.from(doc.querySelectorAll('.js-enhanced-ecommerce-item'));
      for (const itemDiv of itemDivs) {
        const nameDiv = itemDiv.querySelector('.block-bulk-purchase-b--goods-name');
        const code = itemDiv.querySelector('input[name="goods"]').value;
        const name = normalizePartName(nameDiv.textContent);
        const part = this.partByCode(code, name, true);
        const imageDiv = itemDiv.querySelector('.block-bulk-purchase-b--goods-image');
        if (part.orderIds && part.orderIds.length > 0) {
          setBackgroundStyle(itemDiv, COLOR_LIGHT_HISTORY, false);
          imageDiv.appendChild(this.createHistoryBanner(part));
        }
        const quantity = this.partQuantityInCart(code);
        if (quantity > 0) {
          setBackgroundStyle(itemDiv, COLOR_LIGHT_IN_CART, false);
          imageDiv.appendChild(this.createCartIcon(code, quantity));
        }
      }
    }

    // MARK: カタログページを修正
    async fixCatalog(doc) {
      const itemDls = Array.from(doc.querySelectorAll('.block-cart-i--goods'));
      for (const itemDl of itemDls) {
        const link = itemDl.querySelector('.js-enhanced-ecommerce-goods-name');
        const name = normalizePartName(link.title);
        const m = link.href.match(/\/catalog\/g\/g(\d+)\//);
        if (!m) continue;
        const code = m[1];
        const part = this.partByCode(code, name, true);
        const itemDt = itemDl.querySelector('.block-cart-i--goods-image');
        if (part.orderIds && part.orderIds.length > 0) {
          setBackgroundStyle(itemDl, COLOR_LIGHT_HISTORY);
          itemDt.appendChild(this.createHistoryBanner(part));
        }
        const quantity = this.partQuantityInCart(code);
        if (quantity > 0) {
          setBackgroundStyle(itemDl, COLOR_LIGHT_IN_CART);
          itemDt.appendChild(this.createCartIcon(code, quantity));
        }
      }
    }

    /**
     * MARK: 注文情報をIDから取得
     * @param {string} orderId オーダーID
     * @param {number} ts 注文日時
     * @returns {Order} 注文情報
    */
    orderById(orderId, ts) {
      if (orderId in this.db.orders) {
        // 既知の注文の場合はその情報をベースにする
        let order = this.db.orders[orderId];
        if (ts > 0 && order.timestamp < ts) {
          order.timestamp = ts;
          const oldTimeStr = order.timestamp ? new Date(order.timestamp).toLocaleString() : 'null';
          const newTimeStr = new Date(ts).toLocaleString();
          debugLog(`注文日時更新: ${oldTimeStr} --> ${newTimeStr}`);
        }
        return order;
      }
      else {
        // 新規注文の場合は登録
        debugLog(`新規注文情報: ${orderId}`);
        const order = new Order(orderId, ts);
        this.db.orders[orderId] = order;
        return order;
      }
    }

    /**
     * MARK: 商品画像の左下に付けるバナーを生成
     * @param {Part} part
     * @returns {HTMLAnchorElement}
    */
    createHistoryBanner(part) {
      const purchaseCount = !!part.orderIds ? part.orderIds.length : 0;

      const link = document.createElement('a');
      link.href = this.getHistorySearchUrl(part.getName());
      link.style.display = 'inline-block';
      link.style.backgroundColor = COLOR_DARK_HISTORY;
      link.style.padding = '1px 5px';
      link.style.position = 'absolute';
      link.style.right = '0';
      link.style.bottom = '0';
      link.style.borderRadius = '4px';
      link.style.fontSize = '10px';
      link.style.color = '#fff';

      // 購入日
      let orders = [];
      for (let orderId of part.orderIds) {
        if (orderId in this.db.orders) {
          orders.push(this.db.orders[orderId]);
        }
      }
      orders.sort((a, b) => b.timestamp - a.timestamp);

      if (orders.length == 0) {
        // 購入日不明
        link.textContent = `${purchaseCount} 回購入`;
      }
      else if (orders.length == 1 && purchaseCount == 1) {
        // 日付が分かっている 1 回だけ購入
        link.textContent = `${prettyTime(orders[0].timestamp)}に購入`;
      }
      else {
        // 複数回購入
        link.textContent = `${prettyTime(orders[0].timestamp)} + ${purchaseCount - 1} 回購入`;
      }

      const timeStrs = orders.map(order => {
        let line = `・${new Date(order.timestamp).toLocaleDateString()}`;
        if (order.items[part.code].quantity > 0) {
          line += ` (${order.items[part.code].quantity}個)`;
        }
        return line;
      });
      link.title = `${timeStrs.join('\n')}\n${LINK_TITLE}`;

      return link;
    }

    // MARK: カートに入っていることを示すアイコンを生成
    createCartIcon(partCode, quantity) {
      const link = document.createElement('a');
      link.href = this.getCartUrl(partCode);
      link.style.display = 'inline-block';
      link.style.minWidth = '20px';
      link.style.height = '20px';
      link.style.backgroundColor = COLOR_DARK_IN_CART;
      link.style.position = 'absolute';
      link.style.right = '-3px';
      link.style.top = '-3px';
      link.style.borderRadius = '999px';
      link.style.fontSize = '15px';
      link.style.lineHeight = '20px';
      link.style.fontWeight = 'bold';
      link.style.textDecoration = 'none';
      link.style.textAlign = 'center';
      link.style.color = '#fff';
      link.style.padding = '0 5px';
      link.textContent = quantity;
      link.title = LINK_TITLE;
      return link;
    }

    getCartUrl(partCode) {
      let url = 'https://akizukidenshi.com/catalog/cart/cart.aspx';
      if (partCode) url += `#:~:text=${encodeURIComponent(partCode)}`;
      return url;
    }

    // 部品の検索用URLを生成
    getPartSearchUrl(name) {
      return `https://akizukidenshi.com/catalog/goods/search.aspx?search=x&keyword=${encodeURIComponent(name)}&search=search`;
    }

    // 部品の検索用URLを生成
    getHistorySearchUrl(name) {
      return `https://akizukidenshi.com/catalog/customer/history.aspx?order_id=&name=${encodeURIComponent(name)}&year=&search=%E6%A4%9C%E7%B4%A2%E3%81%99%E3%82%8B`;
    }

    /** MARK: 部品情報をIDから取得
     * @param {string} partCode 部品コード
     * @param {string} partName 部品名
     * @returns {Part} 部品情報
     */
    partByCode(partCode, partName, isLatestName = false) {
      this.db.partCodeDict[partName] = partCode;
      if (partCode in this.db.parts) {
        const part = this.db.parts[partCode];
        part.linkToName(partName, isLatestName);
        return part;
      }
      else {
        // 新規部品の場合は登録
        debugLog(`新規部品情報: 通販コード=${partCode}, 部品名=${partName}`);
        const part = new Part(partCode, partName);
        this.db.parts[partCode] = part;
        return part;
      }
    }

    /** 
     * MARK: カートの商品を通販コードから取得
     * @param {string} partCode
     * @param {string} partName
     * @param {number} quantity
     * @returns {CartItem}
    */
    cartItemByCode(partCode, partName, quantity) {
      const now = new Date().getTime();
      let item = new CartItem(partCode, partName, quantity, now);
      if (partCode in this.db.cart) {
        // 既知の商品の場合はその情報をベースにする
        item = this.db.cart[partCode];
        item.isInCart = true;
        item.timestamp = now;
        item.name = partName;
        item.quantity = quantity;
      }
      else {
        // 新規商品の場合は登録
        debugLog(`新しい商品: ${partCode}`);
        this.db.cart[partCode] = item;
      }
      return item;
    }

    /**
     * MARK: カートに入っている部品の数を返す。
     * 当該部品がカートに入っていない場合は 0 を返す
     * @param {string} code 
     * @returns {number}
     */
    partQuantityInCart(code) {
      if (!code || !(code in this.db.cart)) return 0;
      const cartItem = this.db.cart[code];
      return cartItem.isInCart ? cartItem.quantity : 0;
    }

    // MARK: データベースの読み込み
    async loadDatabase() {
      try {
        this.db.loadFromJson(JSON.parse(await GM.getValue(SETTING_KEY)));
        const countSpan = document.querySelector('.block-headernav--cart-count');
        if (!countSpan || parseInt(countSpan.textContent) <= 0) {
          // カートの商品数がゼロになっている場合は全商品をカートから外す
          // 注文確定やセッション切れによってカートが空になった場合を想定
          for (const item of Object.values(this.db.cart)) {
            item.isInCart = false;
          }
        }
        else {
          // 一定以上古い商品は削除する
          const now = new Date().getTime();
          for (const item of Object.values(this.db.cart)) {
            if (now - item.timestamp > CART_ITEM_LIFE_TIME) {
              delete this.db.cart[item.code];
            }
          }
        }
        this.db.version = GM_info.script.version;
        this.reportDatabase();
      }
      catch (e) {
        debugError(`データベースの読み込みに失敗しました: ${e}`);
      }
    }

    // MARK: データベースのクリーンアップ
    async cleanupDatabase() {
      let unusedPartCodes = {};
      let unusedPartNames = {};
      for (const partCode in this.db.parts) {
        unusedPartCodes[partCode] = true;
        this.db.parts[partCode].names = this.db.parts[partCode].names.filter(name => !!name);
        for (const partName in this.db.parts[partCode].names) {
          unusedPartNames[partName] = true;
        }
      }
      for (const partName in this.db.partCodeDict) {
        unusedPartNames[partName] = true;
      }

      for (let order of Object.values(this.db.orders)) {
        for (let cartItem of Object.values(order.items)) {
          if (cartItem.code in unusedPartCodes) delete unusedPartCodes[cartItem.code];
          if (cartItem.name in unusedPartNames) delete unusedPartNames[cartItem.name];
        }
      }

      for (let cartItem of Object.values(this.db.cart)) {
        if (cartItem.code in unusedPartCodes) delete unusedPartCodes[cartItem.code];
        if (cartItem.name in unusedPartNames) delete unusedPartNames[cartItem.name];
      }

      let numDeletedCodes = 0;
      for (const partCode in unusedPartCodes) {
        if (partCode in this.db.parts) {
          delete this.db.parts[partCode];
          numDeletedCodes++;
        }
      }
      if (numDeletedCodes > 0) debugLog(`未使用の通販コードの削除: ${numDeletedCodes}個`);

      let numDeletedNames = 0;
      for (const partName in unusedPartNames) {
        for (let part of Object.values(this.db.parts)) {
          if (part.names.includes(partName)) {
            part.names.splice(part.names.indexOf(partName), 1);
            numDeletedNames++;
          }
        }
        if (partName in this.db.partCodeDict) {
          delete this.db.partCodeDict[partName];
          numDeletedNames++;
        }
      }
      if (numDeletedNames > 0) debugLog(`未使用の部品名の削除: ${numDeletedNames}個`);
    }

    // MARK: データベースの保存
    async saveDatabase() {
      try {
        this.cleanupDatabase();
        this.reportDatabase();
        await GM.setValue(SETTING_KEY, JSON.stringify(this.db));
      }
      catch (e) {
        debugError(`データベースの保存に失敗しました: ${e}`);
      }
    }

    reportDatabase() {
      debugLog(`注文情報: ${Object.keys(this.db.orders).length}件`);
      debugLog(`部品情報: ${Object.keys(this.db.parts).length}件`);
      debugLog(`カート情報: ${Object.keys(this.db.cart).length}件`);
    }
  }

  // MARK: データベース
  class Database {
    constructor() {
      this.version = GM_info.script.version;

      /** @type {Object.<string, string>} */
      this.partCodeDict = {};

      /** @type {Object.<string, Part>} */
      this.parts = {};

      /** @type {Object.<string, Order>} */
      this.orders = {};

      /** @type {Object.<string, CartItem>} */
      this.cart = {};
    }

    /**
     * @param {Object} json 
     * @returns {Database}
     */
    loadFromJson(json) {
      const now = new Date().getTime();

      for (let key in this) {
        if (key == 'parts') {
          // 部品情報
          for (let code in json.parts) {
            let part = new Part(code, null);
            const partJson = json.parts[code];
            if (code.startsWith(NAME_KEY_PREFIX)) {
              // TODO: 削除 (旧バージョンのDB対応)
              if (partJson.code) {
                console.log(`DBマイグレーション: ${code} --> ${partJson.code}`)
                const name = code.slice(NAME_KEY_PREFIX.length);
                this.partCodeDict[name] = partJson.code;
                partJson.names = [name];
                if (partJson.name) delete partJson.name;
              }
            }
            else if (partJson.name) {
              // TODO: 削除 (旧バージョンのDB対応)
              console.log(`DBマイグレーション: ${partJson.name} --> ${code}`)
              this.partCodeDict[partJson.name] = code;
              partJson.names = [partJson.name];
              delete partJson.name;
            }
            this.parts[code] = part.loadFromJson(partJson);
          }
        }
        else if (key == 'orders') {
          // 注文履歴
          for (const id in json.orders) {
            let order = new Order(id, now);
            this.orders[id] = order.loadFromJson(json.orders[id]);
          }
        }
        else if (key == 'cart') {
          // カート履歴
          for (const code in json.cart) {
            let cartItem = new CartItem(code, null, QUANTITY_UNKNOWN, now);
            this.cart[code] = cartItem.loadFromJson(json.cart[code]);
          }
        }
        else if (key in json) {
          this[key] = json[key];
        }
      }

      {
        // TODO: 削除 (旧バージョンのDB対応)
        let numNameUpdates = 0;
        let numNameUnknown = 0;
        const updateItemName = (cartItem) => {
          if (cartItem.name) return;
          if (cartItem.code in this.parts) {
            console.log(`DBマイグレーション: カートの商品名 ${cartItem.code} --> ${this.parts[cartItem.code].getName()}`);
            const newName = this.parts[cartItem.code].getName();
            if (newName) cartItem.name = newName;
            numNameUpdates++;
          }
          else {
            numNameUnknown++;
          }
        };
        for (let order of Object.values(this.orders)) {
          for (let cartItem of Object.values(order.items)) {
            updateItemName(cartItem);
          }
        }
        for (let cartItem of Object.values(this.cart)) {
          updateItemName(cartItem);
        }
        if (numNameUpdates > 0) debugLog(`DBマイグレーション: 部品名更新=${numNameUpdates}`);
        if (numNameUnknown > 0) debugLog(`DBマイグレーション: 部品名不明=${numNameUnknown}`);
      }

      return this;
    }
  }

  // MARK: 部品情報
  class Part {
    /**
     * @param {string} code 
     * @param {string} name 
     */
    constructor(code, name) {
      this.code = code;
      this.names = name ? [name] : [];
      this.orderIds = [];
    }

    /**
     * @returns {string}
     */
    getName() {
      return this.names.length > 0 ? this.names[0] : null;
    }

    /**
     * @param {string} partName 
     * @param {boolean} isLatest
     * @returns {void}
     */
    linkToName(partName, isLatest = false) {
      if (this.names.length > 0 && this.names[0] == partName) return;
      if (this.names.includes(partName)) {
        if (isLatest) {
          this.names.splice(this.names.indexOf(partName), 1);
          this.names.unshift(partName);
        }
      }
      else {
        this.names.unshift(partName);
      }
    }

    /**
     * @param {string} orderId
     * @returns {void}
     */
    linkToOrder(orderId) {
      if (this.orderIds.includes(orderId)) return;
      debugLog(`部品情報に注文情報をリンク: ${this.code} --> ${orderId}`);
      this.orderIds.push(orderId);
    }

    /**
     * @param {Object} json
     * @returns {Part}
     */
    loadFromJson(json) {
      for (let key in this) {
        if (key in json) {
          this[key] = json[key];
        }
      }
      return this;
    }
  }

  // MARK: 買い物かごのアイテム
  class CartItem {
    constructor(code, name, quantity, ts = -1) {
      this.code = code;
      this.name = name;
      this.quantity = quantity;
      this.timestamp = ts;
      this.isInCart = quantity > 0;
    }

    /**
     * @param {Object} json
     * @returns {CartItem}
     */
    loadFromJson(json) {
      for (const key in this) {
        if (key in json) {
          this[key] = json[key];
        }
      }
      return this;
    }
  }

  // MARK: 注文情報
  class Order {
    /**
     * @param {string} id 
     * @param {number} ts 
     */
    constructor(id, ts) {
      this.id = id;
      this.timestamp = ts;
      this.items = {};
    }

    /** @returns {boolean} */
    isFilled() {
      if (this.timestamp == -1) return false;
      for (const code in this.items) {
        const item = this.items[code];
        if (code != item.code) return false;
        if (item.quantity <= 0) return false;
        if (!item.name) return false;
      }
      return true;
    }

    /**
     * @param {string} partName 
     * @returns {string|null}
     */
    partCodeFromName(partName) {
      for (const item of Object.values(this.items)) {
        if (item.name == partName) {
          return item.code;
        }
      }
      return null;
    }

    /**
     * @param {string} code
     * @param {string} name
     * @param {number} quantity
     * @returns {void}
     */
    linkToPart(code, name, quantity = QUANTITY_UNKNOWN) {
      if (code in this.items) {
        let item = this.items[code];
        if (name) item.name = name;
        if (quantity > 0) item.quantity = quantity;
      }
      else {
        debugLog(`注文情報に部品を追加: ${this.id} --> ${code}`);
        this.items[code] = new CartItem(code, name, QUANTITY_UNKNOWN, -1);
      }
    }

    /**
     * @param {Object} json
     * @returns {CartItem}
     */
    loadFromJson(json) {
      // TODO: 削除 (旧バージョンのDB対応)
      if (json.time) {
        json.timestamp = json.time;
        delete json.time;
        debugLog(`DBマイグレーション: Order.time --> Order.timestamp`);
      }

      // TODO: 削除 (旧バージョンのDB対応)
      if (json.itemCodes) {
        json.items = {};
        for (const code of json.itemCodes) {
          json.items[code] = new CartItem(code, null, QUANTITY_UNKNOWN, json.timestamp);
        }
        delete json.itemCodes;
        debugLog(`DBマイグレーション: Order.itemCodes --> Order.items`);
      }

      for (let key in this) {
        if (key == 'items') {
          for (let code in json.items) {
            let item = new CartItem(code, null, QUANTITY_UNKNOWN, json.timestamp);
            this.items[code] = item.loadFromJson(json.items[code]);
          }
        }
        else if (key in json) {
          this[key] = json[key];
        }
      }

      return this;
    }
  }

  // MARK: ウィンドウの作成
  function createWindow(title, width = '300px') {
    const windowDiv = document.createElement('div');
    windowDiv.style.zIndex = '10000';
    windowDiv.style.width = width;
    windowDiv.style.backgroundColor = COLOR_LIGHT_HISTORY;
    windowDiv.style.border = '1px solid #06c';
    windowDiv.style.borderRadius = '5px';
    windowDiv.style.fontSize = '12px';
    windowDiv.style.boxShadow = '0 3px 5px rgba(0,0,0,0.5)';

    const caption = document.createElement('div');
    caption.textContent = title;
    caption.style.backgroundColor = COLOR_DARK_HISTORY;
    caption.style.color = '#fff';
    caption.style.padding = '5px';
    caption.style.fontWeight = 'bold';
    windowDiv.appendChild(caption);

    const closeBox = document.createElement('button');
    closeBox.textContent = '×';
    closeBox.style.position = 'absolute';
    closeBox.style.right = '5px';
    closeBox.style.top = '5px';
    closeBox.style.backgroundColor = '#c44';
    closeBox.style.color = '#fff';
    closeBox.style.border = 'none';
    closeBox.style.borderRadius = '3px';
    closeBox.style.padding = '2px 5px';
    closeBox.style.cursor = 'pointer';
    closeBox.style.fontSize = '12px';
    closeBox.style.lineHeight = '12px';
    closeBox.style.width = '18px';
    closeBox.style.height = '18px';
    windowDiv.appendChild(closeBox);
    windowDiv.closeBox = closeBox;
    closeBox.addEventListener('click', () => {
      windowDiv.remove();
    });

    return windowDiv;
  }

  /**
   * @param {string} innerHTML 
   * @param {string} width 
   * @returns {HTMLButtonElement}
   */
  function createButton(innerHTML, width = null) {
    const button = document.createElement('button');
    button.innerHTML = innerHTML;
    button.style.boxSizing = 'border-box';
    if (width) button.style.width = width;
    button.style.cursor = 'pointer';
    return button;
  }

  function createTable(headerTexts) {
    const table = document.createElement('table');
    table.style.boxSizing = 'border-box';
    table.style.width = 'calc(100% - 20px)'; // こうしないと幅が合わない?
    table.style.padding = '0';
    table.style.backgroundColor = '#fff';
    table.style.margin = PARAGRAPH_MARGIN;
    table.style.borderCollapse = 'collapse';
    table.style.borderSpacing = '0';

    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    tr.style.backgroundColor = COLOR_DARK_HISTORY;
    tr.style.color = '#fff';
    tr.style.fontWeight = 'bold';
    for (let headerText of headerTexts) {
      tr.appendChild(createTableCell(headerText, { isHeader: true, noWrap: true }));
    }
    thead.appendChild(tr);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    table.appendChild(thead);
    return table;
  }

  function createTableCell(html, args = { isHeader: false, textAlign: 'left', noWrap: false }) {
    const td = document.createElement(args.isHeader ? 'th' : 'td');
    td.style.border = `1px solid ${COLOR_DARK_HISTORY}`;
    td.style.padding = '2px 5px';
    td.style.textAlign = args.isHeader ? 'center' : args.textAlign;
    if (args.isHeader) td.style.fontWeight = 'bold';
    if (args.noWrap) td.style.whiteSpace = 'nowrap';
    if (typeof html == 'string' || typeof html == 'number') {
      td.innerHTML = html;
    }
    else if (html instanceof HTMLElement) {
      td.appendChild(html);
    }
    return td;
  }

  function wrapWithParagraph(elems) {
    const p = document.createElement('p');
    p.style.margin = PARAGRAPH_MARGIN;

    if (!Array.isArray(elems)) elems = [elems];
    for (let elem of elems) {
      if (typeof elem == 'string' || typeof html == 'number') {
        const span = document.createElement('span');
        span.innerHTML = elem;
        p.appendChild(span);
      }
      else {
        p.appendChild(elem);
      }
    }

    return p;
  }

  function setBackgroundStyle(elem, color, rounded = true) {
    elem.style.backgroundColor = color;
    if (rounded) elem.style.borderRadius = '5px';
    if (elem.tagName === 'DL') {
      // do nothing
    }
    else if (elem.tagName === 'DIV') {
      elem.style.padding = '5px 10px';
    }
    else {
      elem.style.padding = '2px 5px';
      elem.style.marginRight = '5px';
      elem.style.verticalAlign = 'middle';
    }
  }

  // MARK: HTML をダウンロードしてパース
  async function downloadHtml(url) {
    const res = await fetch(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(await res.text(), 'text/html');
    return doc;
  }

  function parseDate(dateStr) {
    const m = dateStr.match(/\b(\d+)[年\/](\d+)[月\/](\d+)日?(\s+(\d+):(\d+):(\d+))?\b/);
    const year = parseInt(m[1]);
    const month = parseInt(m[2]) - 1;
    const day = parseInt(m[3]);
    let t = new Date(year, month, day).getTime();
    if (!!m[5] && !!m[6] && !!m[7]) {
      const hour = parseInt(m[5]);
      const min = parseInt(m[6]);
      const sec = parseInt(m[7]);
      t = new Date(year, month, day, hour, min, sec).getTime();
    }
    return t;
  }

  function prettyTime(t) {
    const secs = (new Date().getTime() - t) / 1000;
    const mins = secs / 60;
    const hours = mins / 60;
    const days = hours / 24;
    const years = days / 365.2425;
    const month = years * 12;
    if (secs < 1) return '1秒以内';
    if (mins < 1) return `${Math.round(secs)}秒前`;
    if (hours < 1) return `${Math.round(mins)}分前`;
    if (days < 1) return `${Math.round(hours)}時間前`;
    if (month < 1) return `${Math.round(days)}日前`;
    if (years < 1) return `${Math.round(month * 10) / 10}ヶ月前`;
    return `${Math.round(years * 10) / 10}年前`;
  }

  // MARK: 部品名を正規化
  function normalizePartName(name) {
    return toNarrow(name).trim();
  }

  function toNarrow(orig) {
    let ret = orig
      .replaceAll(/[Ａ-Ｚａ-ｚ０-９]/g, m => String.fromCharCode(m.charCodeAt(0) - 0xFEE0))
      .replaceAll('　', ' ')
      .replaceAll('．', '.')
      .replaceAll('，', ',')
      .replaceAll('：', ':')
      .replaceAll('；', ';')
      .replaceAll('－', '-')
      .replaceAll('％', '%')
      .replaceAll('＃', '#')
      .replaceAll('＿', '_')
      .replaceAll('（', '(')
      .replaceAll('）', ')')
      .replaceAll('［', '[')
      .replaceAll('］', ']')
      .replaceAll('｛', '{')
      .replaceAll('｝', '}')
      .replaceAll('／', '/')
      .replaceAll('＼', '\\');
    console.assert(orig.length == ret.length);
    return ret;
  }

  function debugLog(msg) {
    if (DEBUG_MODE) {
      console.log(`[${APP_NAME}] ${msg}`);
    }
  }

  function debugError(msg) {
    if (DEBUG_MODE) {
      debugLog(`ERROR: ${msg}`);
    }
  }

  window.akibst = new AkiBoost();
  window.onload = async () => await window.akibst.start();

})();
