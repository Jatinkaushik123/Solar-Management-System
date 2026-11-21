/**
 * Bijli Wala SIMS — Pure Utility Helpers
 * Standard ES6+ vanilla helper functions
 */
window.BW = window.BW || {};
const BW = window.BW;

(() => {
  "use strict";

  function deepClone(value) {
    if (value == null) return value;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (e) {
        // Fallback for non-cloneable objects
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function dateString(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function todayISO() {
    return dateString(new Date());
  }

  function relativeDate(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return dateString(d);
  }

  function formatDate(value) {
    if (value == null || value === "") return "—";
    const iso = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return String(value);
    const date = new Date(iso + "T12:00:00");
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatINR(value) {
    const num = Math.round(Number(value) || 0);
    return "₹" + num.toLocaleString("en-IN");
  }

  function phoneOk(phone) {
    if (!phone) return false;
    const clean = String(phone).replace(/[\s-]/g, "");
    return /^[6-9]\d{9}$/.test(clean);
  }

  function generateId(prefix, rows = []) {
    let max = 1000;
    for (const r of rows) {
      if (r && typeof r.id === "string") {
        const parts = r.id.split("-");
        const num = parseInt(parts[parts.length - 1], 10);
        if (!Number.isNaN(num) && num > max) max = num;
      }
    }
    return `${prefix}-${max + 1}`;
  }

  function csvCell(value) {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadCSV(filename, headers, rows) {
    const lines = [headers.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push(row.map(csvCell).join(","));
    }
    const csvContent = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function debounce(fn, wait = 250) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  BW.utils = {
    deepClone,
    dateString,
    todayISO,
    relativeDate,
    formatDate,
    formatINR,
    phoneOk,
    generateId,
    csvCell,
    downloadCSV,
    debounce,
    escapeHTML,
  };
})();
