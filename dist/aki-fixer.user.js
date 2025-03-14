// ==UserScript==
// @name        Aki Fixer
// @namespace   https://github.com/shapoco/aki-fixer/raw/refs/heads/main/dist/
// @updateURL   https://github.com/shapoco/aki-fixer/raw/refs/heads/main/dist/aki-fixer.user.js
// @downloadURL https://github.com/shapoco/aki-fixer/raw/refs/heads/main/dist/aki-fixer.user.js
// @match       https://akizukidenshi.com/*
// @match       https://www.akizukidenshi.com/*
// @version     1.0.22
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

  class Order {
    constructor(id) {
      this.id = id;
      this.itemIds = [];
    }
  }

  class Part {
    constructor(id, name) {
      this.id = id;
      this.name = name;
      this.orderIds = [];
    }
  }

  class AkiFixer {
    constructor() {
      this.settings = {
        orders: {},
        parts: {},
        partNames: {},
      };
    }

    start() {
      window.onload = async () => {
        await this.loadSettings();
        if (window.location.href.startsWith('https://akizukidenshi.com/catalog/customer/history.aspx')) {
          await this.scanHistory();
        }
      }
    }

    async scanHistory() {
      const tables = Array.from(document.querySelectorAll('.block-purchase-history--table'));
      for (let table of tables) {
        const orderIdUls = table.querySelector('.block-purchase-history--order-detail-list');
        const orderId = orderIdUls.querySelector('a').textContent.trim();
        const itemDivs = Array.from(table.querySelectorAll('.block-purchase-history--goods-name'));
        
        let order = new Order(orderId);
        if (orderId in this.settings.orders) {
          order = this.settings.orders[orderId];
        }
        else {
          console.log(`[${APP_NAME}] new order ID: ${orderId}`);
          this.settings.orders[orderId] = order;
        }

        for (let itemDiv of itemDivs) {
          const partName = this.normalizePartName(itemDiv.textContent);
          const part = await this.partByName(partName);
          if (!part.orderIds) part.orderIds = [];
          if (!part.orderIds.includes(orderId)) {
            part.orderIds.push(orderId);
          }
          if (!order.itemIds) order.itemIds = [];
          if (!order.itemIds.includes(orderId)) {
            order.itemIds.push(orderId);
          }
        }
      }
      console.log(`[${APP_NAME}] num orders: ${Object.keys(this.settings.orders).length}`);
      console.log(`[${APP_NAME}] num parts: ${Object.keys(this.settings.parts).length}`);
      console.log(`[${APP_NAME}] num part names: ${Object.keys(this.settings.partNames).length}`);
      await this.saveSettings();
    }

    async partByName(name) {
      if (!this.settings.partNames) {
        this.settings.partNames = {};
      }

      const hash = await this.hash(name);
      if (hash in this.settings.partNames) {
        let part = this.settings.partNames[hash];
        if (part.id && part.id in this.settings.parts) {
          return this.settings.parts[part.id];
        }
        else {
          return part;
        }
      }
      else {
        console.log(`[${APP_NAME}] new part name: ${name}`);
        let part = new Part(null, name);
        this.settings.partNames[hash] = part;
        return part;
      }
    }

    normalizePartName(name) {
      return toNarrow(name).trim();
    }

    async hash(name) {
      const encoder = new TextEncoder();
      const data = encoder.encode(name);
      const hash = await crypto.subtle.digest("SHA-256", data)
      return btoa(String.fromCharCode(...new Uint8Array(hash)));
    }

    async loadSettings() {
      try {
        const json = JSON.parse(await GM.getValue(SETTING_KEY));
        if (json) {
          this.settings = Object.assign(this.settings, json);
        }
      }
      catch (e) {
        console.error(`[${APP_NAME}] ${e}`);
      }
    }

    async saveSettings() {
      try {
        await GM.setValue(SETTING_KEY, JSON.stringify(this.settings));
      }
      catch (e) {
        console.error(`[${APP_NAME}] ${e}`);
      }
    }
  }

  function toNarrow(orig) {
    const ret = orig.replaceAll(/[Ａ-Ｚａ-ｚ０-９]/g, m => String.fromCharCode(m.charCodeAt(0) - 0xFEE0));
    console.assert(orig.length == ret.length);
    return ret;
  }

  window.akifix = new AkiFixer();
  window.akifix.start();
})();
