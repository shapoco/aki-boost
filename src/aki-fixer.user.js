// ==UserScript==
// @name        Aki Fixer (Debug)
// @namespace   http://localhost:51680/
// @updateURL   http://localhost:51680/aki-fixer.user.js
// @downloadURL http://localhost:51680/aki-fixer.user.js
// @match       https://akizukidenshi.com/*
// @match       https://www.akizukidenshi.com/*
// @version     1.0.126
// @author      Shapoco
// @description 秋月電子の購入履歴を記憶して商品ページに購入日を表示します。
// @run-at      document-start
// @grant       GM.getValue
// @grant       GM.setValue
// ==/UserScript==

(function () {
  'use strict';

  const APP_NAME = 'Aki Fixer';
  const SETTING_KEY = 'akifix_settings';
  const NAME_KEY_PREFIX = 'akifix-partname-';
  const LINK_TITLE = `${APP_NAME} によるアノテーション`;

  class AkiFixer {
    constructor() {
      this.settings = new Database();
    }

    start() {
      window.onload = async () => {
        await this.loadDatabase();
        if (window.location.href.startsWith('https://akizukidenshi.com/catalog/customer/history.aspx')) {
          await this.scanHistory();
        }
        else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/customer/historydetail.aspx')) {
          await this.scanHistoryDetail();
        }
        else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/g/')) {
          await this.fixItemPage();
        }
        else if (window.location.href.startsWith('https://akizukidenshi.com/catalog/')) {
          await this.fixCatalog();
        }
      }
    }

    // MARK: 購入履歴をスキャン
    async scanHistory() {
      const tables = Array.from(document.querySelectorAll('.block-purchase-history--table'));
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
            console.error(`[${APP_NAME}] part name not found`);
            continue;
          }
          const partName = this.normalizePartName(wideName);
          if (partName != wideName) {
            console.log(`[${APP_NAME}] part name normaliezed: '${wideName}' -> '${partName}'`);
          }

          const part = this.partByName(partName);
          part.linkOrder(id);
          order.linkPart(part.id);

          itemDiv.innerHTML = '';
          const a = document.createElement('a');
          a.title = LINK_TITLE;
          if (part.id && !part.id.startsWith(NAME_KEY_PREFIX)) {
            // 商品コードが分かる場合はリンクを張る
            a.textContent = part.id;
            a.href = `https://akizukidenshi.com/catalog/g/g${part.id}/`;
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
    async scanHistoryDetail() {
      const orderId = document.querySelector('.block-purchase-history-detail--order-id').textContent.trim();
      const time = parseDate(document.querySelector('.block-purchase-history-detail--order-dt').textContent);
      const partTableTbody = document.querySelector('.block-purchase-history-detail--order-detail-items tbody');
      const partRows = Array.from(partTableTbody.querySelectorAll('tr'));

      let order = this.orderById(orderId, time);
      for (let partRow of partRows) {
        const partIdDiv = partRow.querySelector('.block-purchase-history-detail--goods-code');
        const partId = partIdDiv.textContent.trim();
        const wideName = partRow.querySelector('.block-purchase-history-detail--goods-name').textContent;
        const partName = this.normalizePartName(wideName);
        if (partName != wideName) {
          console.log(`[${APP_NAME}] part name normaliezed: '${wideName}' -> '${partName}'`);
        }

        if (!partId || !partName) {
          console.error(`[${APP_NAME}] part ID or name not found`);
          continue;
        }
        let part = this.partById(partId, partName);
        order.linkPart(partId);
        part.linkOrder(orderId);

        // ID にリンクを張る
        partIdDiv.innerHTML = '';
        const a = document.createElement('a');
        a.href = `https://akizukidenshi.com/catalog/g/g${part.id}/`;
        a.textContent = part.id;
        a.title = LINK_TITLE;
        partIdDiv.appendChild(a);
      }
      await this.saveDatabase();
    }

    // MARK: 商品ページを修正
    async fixItemPage() {
      const id = document.querySelector('#hidden_goods').value;
      const wideName = document.querySelector('#hidden_goods_name').value;
      const name = this.normalizePartName(wideName);
      if (name != wideName) {
        console.log(`[${APP_NAME}] part name normaliezed: '${wideName}' -> '${name}'`);
      }

      const part = this.partById(id, name);

      const h1 = document.querySelector('.block-goods-name--text');
      if (!h1) {
        console.error(`[${APP_NAME}] item name not found`);
        return;
      }

      const div = document.createElement('div');
      div.appendChild(document.createTextNode('購入履歴: '));
      for (let orderId of part.orderIds) {
        if (!(orderId in this.settings.orders)) continue;
        const order = this.settings.orders[orderId];
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
        const id = m[1];
        const part = this.partById(id, name);
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
            if (!(orderId in this.settings.orders)) continue;
            time = Math.max(time, this.settings.orders[orderId].time);
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
      if (id in this.settings.orders) {
        // 既知の注文の場合はその情報をベースにする
        order = this.settings.orders[id];
      }
      else {
        // 新規注文の場合は登録
        console.log(`[${APP_NAME}] new order ID: ${id}`);
        this.settings.orders[id] = order;
      }
      if (!order.time || order.time < time) {
        const oldTimeStr = order.time ? new Date(order.time).toLocaleString() : 'null';
        const newTimeStr = new Date(time).toLocaleString();
        console.log(`[${APP_NAME}] order time updated: ${oldTimeStr} --> ${newTimeStr}`);
        order.time = time;
      }
      return order;
    }

    // MARK: 部品情報をIDから取得
    partById(id, name) {
      if (!this.settings.parts) this.settings.parts = {};

      let part = new Part(id, name);

      if (id in this.settings.parts) {
        part = this.settings.parts[id];
      }
      else {
        // 新規部品の場合は登録
        console.log(`[${APP_NAME}] new part ID: ${id}`);
        this.settings.parts[id] = part;
      }

      const nameKey = this.nameKeyOf(name);
      if (nameKey in this.settings.parts) {
        let byName = this.settings.parts[nameKey];
        if (!byName.id) {
          console.log(`[${APP_NAME}] part name linked to ID: ${byName.name} --> ${id}`);
          byName.id = id;
        }
        part.migrateFrom(byName);
      }

      return part;
    }

    // MARK: 部品情報を名前から取得
    partByName(name) {
      if (!this.settings.parts) this.settings.parts = {};

      let part = new Part(null, name);

      // ハッシュで参照
      const nameKey = this.nameKeyOf(name);
      if (nameKey in this.settings.parts) {
        part = this.settings.parts[nameKey];
        if (part.id && !part.id.startsWith(NAME_KEY_PREFIX) && part.id in this.settings.parts) {
          // 品番が登録済みの場合はその情報を返す
          part = this.settings.parts[part.id];
        }
      }
      else {
        // 新規部品の場合は登録
        console.log(`[${APP_NAME}] new part name: ${name}`);
        this.settings.parts[nameKey] = part;
      }
      return part;
    }

    // MARK: 部品名を正規化
    normalizePartName(name) {
      return toNarrow(name).trim();
    }

    // MARK: 部品名をハッシュ化
    nameKeyOf(name) {
      return this.normalizePartName(name)
        .replaceAll(/[-\/\s]/g, '');
    }

    // MARK: データベースの読み込み
    async loadDatabase() {
      try {
        const json = JSON.parse(await GM.getValue(SETTING_KEY));
        if (json) {
          if (json.orders) {
            for (const key in json.orders) {
              this.settings.orders[key] = Object.assign(new Order(null), json.orders[key]);
            }
          }
          if (json.parts) {
            for (const key in json.parts) {
              this.settings.parts[key] = Object.assign(new Part(null, null), json.parts[key]);
            }
          }
        }
      }
      catch (e) {
        console.error(`[${APP_NAME}] ${e}`);
      }
    }

    // MARK: データベースの保存
    async saveDatabase() {
      try {
        console.log(`[${APP_NAME}] num orders: ${Object.keys(this.settings.orders).length}`);
        console.log(`[${APP_NAME}] num parts: ${Object.keys(this.settings.parts).length}`);
        await GM.setValue(SETTING_KEY, JSON.stringify(this.settings));
      }
      catch (e) {
        console.error(`[${APP_NAME}] ${e}`);
      }
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
      this.partIds = [];
    }

    linkPart(partId) {
      if (this.partIds.includes(partId)) return;
      console.log(`[${APP_NAME}] order linked to part: ${this.id} --> ${partId}`);
      this.partIds.push(partId);
    }
  }

  // MARK: 部品情報
  class Part {
    constructor(id, name) {
      this.id = id;
      this.name = name;
      this.orderIds = [];
    }

    linkOrder(orderId) {
      if (this.orderIds.includes(orderId)) return;
      console.log(`[${APP_NAME}] part linked to order: ${this.id} --> ${orderId}`);
      this.orderIds.push(orderId);
    }

    migrateFrom(other) {
      for (let orderId of other.orderIds) {
        this.linkOrder(orderId);
      }
      other.orderIds = [];
    }
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

  window.akifix = new AkiFixer();
  window.akifix.start();
})();
