// ==UserScript==
// @name        Aki Fixer
// @namespace   https://github.com/shapoco/aki-fixer/raw/refs/heads/main/dist/
// @updateURL   https://github.com/shapoco/aki-fixer/raw/refs/heads/main/dist/aki-fixer.user.js
// @downloadURL https://github.com/shapoco/aki-fixer/raw/refs/heads/main/dist/aki-fixer.user.js
// @match       https://akizukidenshi.com/*
// @match       https://www.akizukidenshi.com/*
// @version     1.0.73
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
  const HASH_PREFIX = 'akifix-namehash-';
  const LINK_TITLE = `${APP_NAME} によって作成されたリンク`;

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
          const partName = this.normalizePartName(itemDiv.textContent);
          if (!partName) {
            console.error(`[${APP_NAME}] part name not found`);
            continue;
          }

          const part = await this.partByName(partName);
          part.linkOrder(id);
          order.linkPart(part.id);

          // ID が分かる場合はリンクを張る
          if (part.id && !part.id.startsWith(HASH_PREFIX)) {
            itemDiv.innerHTML = `<a href="https://akizukidenshi.com/catalog/g/g${part.id}/" title="${LINK_TITLE}">${part.id}</a> | ${itemDiv.textContent}`;
          }
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
        const partName = this.normalizePartName(partRow.querySelector('.block-purchase-history-detail--goods-name').textContent);
        if (!partId || !partName) {
          console.error(`[${APP_NAME}] part ID or name not found`);
          continue;
        }
        let part = await this.partById(partId, partName);
        order.linkPart(partId);
        part.linkOrder(orderId);

        // ID にリンクを張る
        partIdDiv.innerHTML = `<a href="https://akizukidenshi.com/catalog/g/g${part.id}/" title="${LINK_TITLE}">${part.id}</a>`;
      }
      await this.saveDatabase();
    }

    async fixItemPage() {
      const id = document.querySelector('#hidden_goods').value;
      const name = document.querySelector('#hidden_goods_name').value;
      const part = await this.partById(id, name);

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

      h1.parentElement.appendChild(div);

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
    async partById(id, name) {
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

      const hash = await this.hashOf(name);
      if (hash in this.settings.parts) {
        let byName = this.settings.parts[hash];
        if (!byName.id) {
          console.log(`[${APP_NAME}] part name linked to ID: ${byName.name} --> ${id}`);
          byName.id = id;
        }
        part.migrateFrom(byName);
      }

      return part;
    }

    // MARK: 部品情報を名前から取得
    async partByName(name) {
      if (!this.settings.parts) this.settings.parts = {};

      let part = new Part(null, name);

      // ハッシュで参照
      const hash = await this.hashOf(name);
      if (hash in this.settings.parts) {
        part = this.settings.parts[hash];
        if (part.id && !part.id.startsWith(HASH_PREFIX) && part.id in this.settings.parts) {
          // 品番が登録済みの場合はその情報を返す
          part = this.settings.parts[part.id];
        }
      }
      else {
        // 新規部品の場合は登録
        console.log(`[${APP_NAME}] new part name: ${name}`);
        this.settings.parts[hash] = part;
      }
      return part;
    }

    // MARK: 部品名を正規化
    normalizePartName(name) {
      return toNarrow(name).trim();
    }

    // MARK: 部品名をハッシュ化
    async hashOf(name) {
      const encoder = new TextEncoder();
      const data = encoder.encode(name);
      const hash = await crypto.subtle.digest("SHA-256", data)
      return HASH_PREFIX + btoa(String.fromCharCode(...new Uint8Array(hash)));
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

  function toNarrow(orig) {
    const ret = orig.replaceAll(/[Ａ-Ｚａ-ｚ０-９]/g, m => String.fromCharCode(m.charCodeAt(0) - 0xFEE0));
    console.assert(orig.length == ret.length);
    return ret;
  }

  window.akifix = new AkiFixer();
  window.akifix.start();
})();
