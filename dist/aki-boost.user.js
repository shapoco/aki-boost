// ==UserScript==
// @name        Aki Boost
// @namespace   https://github.com/shapoco/aki-boost/raw/refs/heads/main/dist/
// @updateURL   https://github.com/shapoco/aki-boost/raw/refs/heads/main/dist/aki-boost.user.js
// @downloadURL https://github.com/shapoco/aki-boost/raw/refs/heads/main/dist/aki-boost.user.js
// @match       https://akizukidenshi.com/*
// @match       https://www.akizukidenshi.com/*
// @version     1.0.212
// @author      Shapoco
// @description 秋月電子の購入履歴を記憶して商品ページに購入日を表示します。
// @run-at      document-start
// @grant       GM.getValue
// @grant       GM.setValue
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG_MODE = false;

  const APP_NAME = 'Aki Boost';
  const SETTING_KEY = 'akibst_settings';
  const NAME_KEY_PREFIX = 'akibst-partname-';
  const LINK_TITLE = `${APP_NAME} によるアノテーション`;

  class AkiBoost {
    constructor() {
      this.db = new Database();
      this.menuOpenButton = document.createElement('button');
      this.menuWindow = createWindow(APP_NAME, '250px');
      this.databaseInfoLabel = document.createElement('span');
      this.isLoggedIn = false;
    }

    async start() {
      this.checkLoginState();

      await this.loadDatabase();

      this.setupMenu();

      if (window.location.href.startsWith('https://akizukidenshi.com/catalog/customer/history.aspx')) {
        await this.scanHistory(document);
      }
      else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/customer/historydetail.aspx')) {
        await this.scanHistoryDetail(document);
      }
      else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/g/')) {
        await this.fixItemPage();
      }
      else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/')) {
        await this.fixCatalog();
      }
    }

    checkLoginState() {
      this.isLoggedIn =
        !!Array.from(document.querySelectorAll('img'))
          .find(img => img.alt == 'マイページ');
    }

    // MARK: メニュー
    setupMenu() {
      this.menuOpenButton.textContent = `⚙ ${APP_NAME}`;
      this.menuOpenButton.style.writingMode = 'vertical-rl';
      this.menuOpenButton.style.position = 'fixed';
      this.menuOpenButton.style.left = '0px';
      this.menuOpenButton.style.bottom = '100px';
      this.menuOpenButton.style.zIndex = '10000';
      this.menuOpenButton.style.padding = '10px 5px';
      this.menuOpenButton.style.backgroundColor = '#06c';
      this.menuOpenButton.style.borderStyle = 'none';
      this.menuOpenButton.style.borderRadius = '0 5px 5px 0';
      this.menuOpenButton.style.color = '#fff';
      this.menuOpenButton.style.fontSize = '12px';
      this.menuOpenButton.style.cursor = 'pointer';
      document.body.appendChild(this.menuOpenButton);

      this.menuWindow.style.position = 'fixed';
      this.menuWindow.style.left = '40px';
      this.menuWindow.style.bottom = '100px';
      this.menuWindow.style.display = 'none';

      const closeButton = document.createElement('button');
      closeButton.textContent = '×';
      closeButton.style.position = 'absolute';
      closeButton.style.right = '5px';
      closeButton.style.top = '5px';
      closeButton.style.backgroundColor = '#c44';
      closeButton.style.color = '#fff';
      closeButton.style.border = 'none';
      closeButton.style.borderRadius = '3px';
      closeButton.style.padding = '2px 5px';
      closeButton.style.cursor = 'pointer';
      closeButton.style.fontSize = '12px';
      closeButton.style.lineHeight = '12px';
      closeButton.style.width = '18px';
      closeButton.style.height = '18px';
      this.menuWindow.appendChild(closeButton);

      this.menuWindow.appendChild(wrapWithParagraph(this.databaseInfoLabel));
      this.updateDatabaseInfo();

      const learnButton = createButton('購入履歴を読み込む', '100%');
      this.menuWindow.appendChild(wrapWithParagraph(learnButton));
      if (!this.isLoggedIn) {
        learnButton.disabled = true;
        this.menuWindow.appendChild(wrapWithParagraph(
          '※ 購入履歴を読み込む前に <a href="https://akizukidenshi.com/catalog/customer/menu.aspx">ログイン</a> してください。'));
      }

      const resetButton = createButton('データベースをリセット', '100%');
      this.menuWindow.appendChild(wrapWithParagraph(resetButton));

      document.body.appendChild(this.menuWindow);

      this.menuOpenButton.addEventListener('click', () => {
        this.updateDatabaseInfo();
        this.menuWindow.style.display = this.menuWindow.style.display === 'none' ? 'block' : 'none';
      });

      closeButton.addEventListener('click', () => {
        this.menuWindow.style.display = 'none';
      });

      resetButton.addEventListener('click', async () => {
        if (confirm('データベースをリセットしますか？')) {
          this.db = new Database();
          await this.saveDatabase();
          this.updateDatabaseInfo();
        }
      });

      learnButton.addEventListener('click', async () => {
        this.menuWindow.style.display = 'none';
        try {
          await this.openLoadHistoryTool();
        }
        catch (e) {
          debugError(e);
        }
      });
    }

    // MARK: 購入履歴の読み込み
    async openLoadHistoryTool() {
      this.menuOpenButton.disabled = true;

      this.loadDatabase();

      const toolWindow = createWindow('購入履歴の読み込み', '300px');
      toolWindow.style.position = 'fixed';
      toolWindow.style.left = '50%';
      toolWindow.style.top = '50%';
      toolWindow.style.transform = 'translate(-50%, -50%)';
      document.body.appendChild(toolWindow);

      const status = wrapWithParagraph('[開始] ボタンで読み込みを開始します。');
      toolWindow.appendChild(status);

      const progressBar = document.createElement('progress');
      progressBar.max = 100;
      progressBar.value = 0;
      progressBar.style.width = '100%';
      progressBar.style.opacity = '0.25';
      toolWindow.appendChild(wrapWithParagraph(progressBar));

      const startButton = createButton('開始', '80px');
      const closeButton = createButton('閉じる', '80px');
      const p = wrapWithParagraph([startButton, '\n', closeButton]);
      p.style.textAlign = 'center';
      toolWindow.appendChild(p);

      closeButton.addEventListener('click', () => {
        toolWindow.remove();
        this.menuOpenButton.disabled = false;
      });

      startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        closeButton.disabled = true;
        progressBar.style.opacity = '1';
        await this.loadHistory(status, progressBar);
        closeButton.disabled = false;
      });
    }

    async loadHistory(status, progressBar) {
      const unknownOrderIds = Object.keys(this.db.orders);

      try {
        const PAGE_STRIDE = DEBUG_MODE ? 5 : 100;

        status.textContent = `オーダー ID を列挙しています...`;
        let doc = await this.downloadHtml(`https://akizukidenshi.com/catalog/customer/history.aspx?ps=${PAGE_STRIDE}`);

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
          doc = await this.downloadHtml(nextLink.href);
        }

        // オーダーID ごとに詳細を読み込む
        let numLoaded = 0;
        for (let i = 0; i < orderIds.length; i++) {
          const orderId = orderIds[i];
          if (!(orderId in this.db.orders)) {
            status.textContent = `購入履歴を読み込んでいます... (${i + 1}/${orderIds.length})`;
            progressBar.value = i * 100 / orderIds.length;

            const doc = await this.downloadHtml(`https://akizukidenshi.com/catalog/customer/historydetail.aspx?order_id=${encodeURIComponent(orderId)}`);
            this.scanHistoryDetail(doc);

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
        this.saveDatabase();

        if (numLoaded == 0) {
          status.textContent = '新しい購入履歴はありませんでした。';
        }
        else {
          status.textContent = `${numLoaded} 件の購入履歴が新たに読み込まれました。`;
        }
        progressBar.value = 100;
      }
      catch (e) {
        this.db = bkp;
        const msg = `⚠ 読み込みに失敗しました`;
        debugError(`${msg}: ${e}`);
        status.textContent = msg;
      }
    }

    async downloadHtml(url) {
      const res = await fetch(url);
      const parser = new DOMParser();
      const doc = parser.parseFromString(await res.text(), 'text/html');
      return doc;
    }

    updateDatabaseInfo() {
      this.databaseInfoLabel.innerHTML =
        `記憶している注文情報: ${Object.keys(this.db.orders).length}件<br>` +
        `記憶している部品情報: ${Object.keys(this.db.parts).length}件`;
    }

    // MARK: 購入履歴をスキャン
    async scanHistory(doc) {
      const tables = Array.from(doc.querySelectorAll('.block-purchase-history--table'));
      for (let table of tables) {
        const idUls = table.querySelector('.block-purchase-history--order-detail-list');

        const id = idUls.querySelector('a').textContent.trim();
        const time = parseDate(table.querySelector('.block-purchase-history--order_dt').textContent);
        let order = this.orderById(id, time);

        const itemDivs = Array.from(table.querySelectorAll('.block-purchase-history--goods-name'));
        for (let itemDiv of itemDivs) {
          // 部品情報の取得
          const wideName = this.normalizePartName(itemDiv.textContent);
          if (!wideName) {
            debugError(`部品名の要素が見つかりませんでした`);
            continue;
          }
          const partName = this.normalizePartName(wideName);
          if (partName != wideName) {
            debugLog(`部品名正規化: '${wideName}' -> '${partName}'`);
          }

          const part = this.partByName(partName);
          part.linkOrder(id);
          order.linkPart(part.code);

          itemDiv.innerHTML = '';
          const a = document.createElement('a');
          a.title = LINK_TITLE;
          if (part.code && !part.code.startsWith(NAME_KEY_PREFIX)) {
            // 商品コードが分かる場合はリンクを張る
            a.textContent = part.code;
            a.href = `https://akizukidenshi.com/catalog/g/g${part.code}/`;
          }
          else {
            // 商品コードが分からない場合は検索リンクにする
            const keyword = partName.replaceAll(/\s*\([^\)]+入\)$/g, '');
            a.textContent = '検索';
            a.href = `https://akizukidenshi.com/catalog/goods/search.aspx?search=x&keyword=${encodeURIComponent(keyword)}&search=search`;
          }
          setBackgroundStyle(a);
          itemDiv.appendChild(a);
          itemDiv.appendChild(document.createTextNode(partName));
        }
      }
      await this.saveDatabase();
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
        const wideName = partRow.querySelector('.block-purchase-history-detail--goods-name').textContent;
        const partName = this.normalizePartName(wideName);
        if (partName != wideName) {
          debugLog(`部品名正規化: '${wideName}' -> '${partName}'`);
        }

        if (!partCode || !partName) {
          debugError(`通販コードまたは部品名が見つかりません`);
          continue;
        }
        let part = this.partByCode(partCode, partName);
        order.linkPart(partCode);
        part.linkOrder(orderId);

        // ID にリンクを張る
        partCodeDiv.innerHTML = '';
        const a = document.createElement('a');
        a.href = `https://akizukidenshi.com/catalog/g/g${part.code}/`;
        a.textContent = part.code;
        a.title = LINK_TITLE;
        partCodeDiv.appendChild(a);
      }
      await this.saveDatabase();
    }

    // MARK: 商品ページを修正
    async fixItemPage() {
      const code = document.querySelector('#hidden_goods').value;
      const wideName = document.querySelector('#hidden_goods_name').value;
      const name = this.normalizePartName(wideName);
      if (name != wideName) {
        debugLog(`部品名正規化: '${wideName}' -> '${name}'`);
      }

      const part = this.partByCode(code, name);

      const h1 = document.querySelector('.block-goods-name--text');
      if (!h1) {
        debugError(`部品名が見つかりません`);
        return;
      }

      const div = document.createElement('div');
      div.appendChild(document.createTextNode('購入履歴: '));
      for (let orderId of part.orderIds) {
        if (!(orderId in this.db.orders)) continue;
        const order = this.db.orders[orderId];
        const link = document.createElement('a');
        link.href = `https://akizukidenshi.com/catalog/customer/historydetail.aspx?order_id=${orderId}`;
        link.textContent = new Date(order.time).toLocaleDateString();
        link.title = LINK_TITLE;
        div.appendChild(link);
        div.appendChild(document.createTextNode(' | '));
      }
      {
        const link = document.createElement('a');
        link.href = `https://akizukidenshi.com/catalog/customer/history.aspx?order_id=&name=${encodeURIComponent(name)}&year=&search=%E6%A4%9C%E7%B4%A2%E3%81%99%E3%82%8B      `;
        link.textContent = "購入履歴から検索";
        link.title = LINK_TITLE;
        div.appendChild(link);
      }
      setBackgroundStyle(div);

      h1.parentElement.appendChild(div);

      await this.saveDatabase();
    }

    // MARK: カタログページを修正
    async fixCatalog() {
      const itemDls = Array.from(document.querySelectorAll('.block-cart-i--goods'));
      for (const itemDl of itemDls) {
        const link = itemDl.querySelector('.js-enhanced-ecommerce-goods-name');
        const name = this.normalizePartName(link.title);
        const m = link.href.match(/\/catalog\/g\/g(\d+)\//);
        if (!m) continue;
        const code = m[1];
        const part = this.partByCode(code, name);
        if (part.orderIds && part.orderIds.length > 0) {
          setBackgroundStyle(itemDl);

          const itemDt = itemDl.querySelector('.block-cart-i--goods-image');
          const div = document.createElement('div');
          div.style.backgroundColor = '#06c';
          div.style.padding = '1px 5px';
          div.style.position = 'absolute';
          div.style.right = '0';
          div.style.bottom = '0';
          div.style.borderRadius = '4px';
          div.style.fontSize = '10px';
          div.style.color = '#fff';
          let time = -1;
          for (let orderId of part.orderIds) {
            if (!(orderId in this.db.orders)) continue;
            time = Math.max(time, this.db.orders[orderId].time);
          }
          if (time >= 0) {
            div.innerText = prettyDate(time) + 'に購入';
            div.title = new Date(time).toLocaleString() + '\n' + LINK_TITLE;
          }
          else {
            div.innerText = part.orderIds.length + '回購入';
            div.title = LINK_TITLE;

          }
          itemDt.appendChild(div);
        }
      }
      await this.saveDatabase();
    }

    // MARK: 注文情報をIDから取得
    orderById(id, time) {
      let order = new Order(id, time);
      if (id in this.db.orders) {
        // 既知の注文の場合はその情報をベースにする
        order = this.db.orders[id];
      }
      else {
        // 新規注文の場合は登録
        debugLog(`新規注文情報: ${id}`);
        this.db.orders[id] = order;
      }
      if (!order.time || order.time < time) {
        const oldTimeStr = order.time ? new Date(order.time).toLocaleString() : 'null';
        const newTimeStr = new Date(time).toLocaleString();
        debugLog(`注文日時更新: ${oldTimeStr} --> ${newTimeStr}`);
        order.time = time;
      }
      return order;
    }

    // MARK: 部品情報をIDから取得
    partByCode(code, name) {
      if (!this.db.parts) this.db.parts = {};

      let part = new Part(code, name);

      if (code in this.db.parts) {
        part = this.db.parts[code];
      }
      else {
        // 新規部品の場合は登録
        debugLog(`新規部品情報: 通販コード=${code}, 部品名=${name}`);
        this.db.parts[code] = part;
      }

      const nameKey = this.nameKeyOf(name);
      if (nameKey in this.db.parts) {
        let byName = this.db.parts[nameKey];
        if (!byName.code) {
          debugLog(`部品名を通販コードにリンク: ${byName.name} --> ${code}`);
          byName.code = code;
        }
        part.migrateFrom(byName);
      }
      else {
        this.db.parts[nameKey] = new Part(code, name);
      }

      return part;
    }

    // MARK: 部品情報を名前から取得
    partByName(name) {
      if (!this.db.parts) this.db.parts = {};

      let part = new Part(null, name);

      // ハッシュで参照
      const nameKey = this.nameKeyOf(name);
      if (nameKey in this.db.parts) {
        part = this.db.parts[nameKey];
        if (part.code && !part.code.startsWith(NAME_KEY_PREFIX) && part.code in this.db.parts) {
          // 品番が登録済みの場合はその情報を返す
          part = this.db.parts[part.code];
        }
      }
      else {
        // 新規部品の場合は登録
        debugLog(`新しい部品名: ${name}`);
        this.db.parts[nameKey] = part;
      }
      return part;
    }

    // MARK: 部品名を正規化
    normalizePartName(name) {
      return toNarrow(name).trim();
    }

    // MARK: 部品名をハッシュ化
    nameKeyOf(name) {
      return NAME_KEY_PREFIX +
        this.normalizePartName(name).replaceAll(/[-\/\s]/g, '');
    }

    // MARK: データベースの読み込み
    async loadDatabase() {
      try {
        const json = JSON.parse(await GM.getValue(SETTING_KEY));
        if (json) {
          if (json.orders) {
            for (const key in json.orders) {
              this.db.orders[key] = Object.assign(new Order(null), json.orders[key]);
            }
          }
          if (json.parts) {
            for (const key in json.parts) {
              this.db.parts[key] = Object.assign(new Part(null, null), json.parts[key]);
            }
          }
        }
        this.reportDatabase();
      }
      catch (e) {
        debugError(`データベースの読み込みに失敗しました: ${e}`);
      }
    }

    // MARK: データベースの保存
    async saveDatabase() {
      try {
        this.reportDatabase();
        await GM.setValue(SETTING_KEY, JSON.stringify(this.db));
      }
      catch (e) {
        debugError(`データベースの保存に失敗しました: ${e}`);
      }
    }

    reportDatabase() {
      let partWithName = 0;
      for (const key in this.db.parts) {
        if (key.startsWith(NAME_KEY_PREFIX)) {
          partWithName++;
        }
      }
      debugLog(`注文情報: ${Object.keys(this.db.orders).length}件`);
      debugLog(`部品情報: ${Object.keys(this.db.parts).length - partWithName} + ${partWithName}件`);
    }
  }

  // MARK: データベース
  class Database {
    constructor() {
      this.orders = {};
      this.parts = {};
    }
  }

  // MARK: 注文情報
  class Order {
    constructor(id, time) {
      this.id = id;
      this.time = time;
      this.itemCodes = [];
    }

    linkPart(itemCode) {
      if (this.itemCodes.includes(itemCode)) return;
      debugLog(`注文情報に部品を追加: ${this.id} --> ${itemCode}`);
      this.itemCodes.push(itemCode);
    }
  }

  // MARK: 部品情報
  class Part {
    constructor(code, name) {
      this.code = code;
      this.name = name;
      this.orderIds = [];
    }

    linkOrder(orderId) {
      if (this.orderIds.includes(orderId)) return;
      debugLog(`部品情報に注文情報をリンク: ${this.code} --> ${orderId}`);
      this.orderIds.push(orderId);
    }

    migrateFrom(other) {
      for (let orderId of other.orderIds) {
        this.linkOrder(orderId);
      }
      other.orderIds = [];
    }
  }

  function createWindow(title, width = '300px') {
    const div = document.createElement('div');
    div.style.zIndex = '10000';
    div.style.width = width;
    div.style.backgroundColor = '#def';
    div.style.border = '1px solid #06c';
    div.style.borderRadius = '5px';
    div.style.fontSize = '12px';
    div.style.boxShadow = '0 3px 5px rgba(0,0,0,0.5)';

    const caption = document.createElement('div');
    caption.textContent = title;
    caption.style.backgroundColor = '#06c';
    caption.style.color = '#fff';
    caption.style.padding = '5px';
    div.appendChild(caption);

    return div;
  }

  function createButton(text, width = null) {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.boxSizing = 'border-box';
    if (width) button.style.width = width;
    button.style.cursor = 'pointer';
    return button;
  }

  function wrapWithParagraph(elems) {
    const p = document.createElement('p');
    p.style.margin = '5px';

    if (!Array.isArray(elems)) elems = [elems];
    for (let elem of elems) {
      if (typeof elem == 'string') {
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

  function setBackgroundStyle(elem) {
    elem.style.backgroundColor = '#def';
    elem.style.borderRadius = '5px';
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

  function prettyDate(t) {
    const days = (new Date().getTime() - t) / (1000 * 86400);
    const years = days / 365.2425;
    const month = years * 12;
    if (days < 1) return '1日以内';
    if (month < 1) return `${Math.round(days)}日前`;
    if (years < 1) return `${Math.round(month * 10) / 10}ヶ月前`;
    return `${Math.round(years * 10) / 10}年前`;
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
