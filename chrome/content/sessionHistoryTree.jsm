/*
    Session History Tree, extension for Firefox 3.6+
    Copyright (C) 2011  Daniel Dawson <ddawson@icehouse.net>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

var EXPORTED_SYMBOLS = ["sessionHistoryTree"];

const Cc = Components.classes, Ci = Components.interfaces,
      Cu = Components.utils;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyServiceGetter(
  this, "consoleSvc", "@mozilla.org/consoleservice;1", "nsIConsoleService");
XPCOMUtils.defineLazyServiceGetter(
  this, "sStore", "@mozilla.org/browser/sessionstore;1", "nsISessionStore");
XPCOMUtils.defineLazyServiceGetter(
  this, "ioSvc", "@mozilla.org/network/io-service;1", "nsIIOService");
XPCOMUtils.defineLazyServiceGetter(
  this, "faviconSvc", "@mozilla.org/browser/favicon-service;1",
  "nsIFaviconService");
XPCOMUtils.defineLazyServiceGetter(
  this, "promptSvc", "@mozilla.org/embedcomp/prompt-service;1",
  "nsIPromptService");
XPCOMUtils.defineLazyGetter(
  this, "prefs", function ()
    Cc["@mozilla.org/preferences-service;1"].
    getService(Ci.nsIPrefService).getBranch("extensions.sessionhistorytree."));
XPCOMUtils.defineLazyGetter(
  this, "strings", function ()
    Cc["@mozilla.org/intl/stringbundle;1"].
    getService(Ci.nsIStringBundleService).
    createBundle("chrome://sessionhistorytree/locale/sht.properties"));

function log (aMsg) {
  consoleSvc.logStringMessage("Session History Tree: " + aMsg);
}

function thisWrap (func, thisObj)
  function () func.apply(thisObj, arguments);

var sessionHistoryTree = {
  sHistoryHandlers: {},
  browserWindows: {},

  registerLoadHandler: function (win) {
    win.addEventListener(
      "load", sessionHistoryTree.windowLoadHandler, false);
  },

  windowLoadHandler: function __wlHandler (evt) {
    var theWindow = evt.target.defaultView;
    sessionHistoryTree.sHistoryHandlers[theWindow] = {};
    var gBr = theWindow.gBrowser, tc = gBr.tabContainer;
    for (let i = 0; i < tc.itemCount; i++) {
      let theTab = tc.getItemAtIndex(i),
          theBrowser = gBr.browsers[i];
      let callback = thisWrap(function () {
        this.initTree(theTab);
        let newSHHandler = new SHistoryHandler(theTab, theBrowser);
        theBrowser.sessionHistory.addSHistoryListener(newSHHandler);
        this.sHistoryHandlers[theWindow][theBrowser] = newSHHandler;
        this.browserWindows[theBrowser] = theWindow;
        theTab.removeEventListener("load", callback, false);
      }, sessionHistoryTree);
      theTab.addEventListener("load", callback, false);
    }

    tc.addEventListener(
      "TabOpen",
      thisWrap(function (evt) {
          var theTab = evt.target, theBrowser = gBr.getBrowserForTab(theTab);
          this.initTree(theTab);
          var newSHHandler = new SHistoryHandler(theTab, theBrowser);
          theBrowser.sessionHistory.addSHistoryListener(newSHHandler);
          var theWindow = theTab.ownerDocument.defaultView;
          this.sHistoryHandlers[theWindow][theBrowser] = newSHHandler;
          this.browserWindows[theBrowser] = theWindow;
        }, sessionHistoryTree),
      false);

    tc.addEventListener(
      "TabClose",
      thisWrap(function (evt) {
          var theTab = evt.target, theBrowser = gBr.getBrowserForTab(theTab);
          delete this.sHistoryHandlers[theWindow][theBrowser];
        }, sessionHistoryTree),
      false);

    gBr.tabContainer.addEventListener(
      "SSTabRestored",
      thisWrap(function (evt) {
          log("SSTabRestored");
          var theTab = evt.target, theBrowser = gBr.getBrowserForTab(theTab);
          for each (var handler in this.sHistoryHandlers[theWindow])
          handler.endRestorePhase();
        }, sessionHistoryTree),
      false);

    theWindow.FillHistoryMenu =
      getSHTFillHistoryMenu(theWindow.FillHistoryMenu);

    theWindow.removeEventListener("load", __wlHandler, false);
  },

  initTree: function (aTab) {
    var curSHTStr = sStore.getTabValue(aTab, "sessionHistoryTree");
    if (!curSHTStr) {
      let newSHTObj = {
        tree: [],
        curPathPos: 0,
        curPathLength: 0
      };
      sStore.setTabValue(aTab, "sessionHistoryTree",
                         JSON.stringify(newSHTObj));
    }
  },

  clearTree: function (aWindow) {
    var tab = aWindow.gBrowser.selectedTab,
        browser = aWindow.gBrowser.selectedBrowser;
    var res = promptSvc.confirmEx(
      browser.contentWindow,
      strings.GetStringFromName("clearingtree_title"),
      strings.GetStringFromName("clearingtree_label"),
      promptSvc.STD_YES_NO_BUTTONS, null, null, null, null, {});
    if (res != 0) return;

    var st = JSON.parse(sStore.getTabState(tab));
    var newSHTObj = {
      tree: [],
      curPathPos: st.index - 1,
      curPathLength: st.entries.length
    };

    var tree = newSHTObj.tree;
    for (var i = 0; i <= st.entries.length; i++) {
      let node = {
        entry: st.entries[i],
        subtree: []
      };
      tree.push(node);
      tree = node.subtree;
    }
    sStore.setTabValue(tab, "sessionHistoryTree", JSON.stringify(newSHTObj));
  },
};

function SHistoryHandler (aTab, aBrowser) {
  this.tab = aTab;
  this.browser = aBrowser;
  this.restorePhase = true;
  this.numIgnores = -1;
}

SHistoryHandler.prototype = {
  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsISHistoryListener, Ci.nsISupports, Ci.nsISupportsWeakReference]),

  startRestorePhase: function () {
    this.restorePhase = true;
    this.numIgnores = -1;
  },

  endRestorePhase: function () {
    this.restorePhase = false;
  },

  OnHistoryGoBack: function (aBackURI) {
    this.restorePhase = false;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));

    var curTree = sht.tree;
    var curNode, curEntry;
    for (var i = 0; i < sht.curPathPos; i++) {
      curNode = curTree[0];
      curEntry = curNode.entry;
      curTree = curNode.subtree;
    }

    if (curNode)
      curNode.entry = tabSt.entries[tabSt.index - 1];
    
    sht.curPathPos--;
    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));
    return true;
  },

  OnHistoryGoForward: function (aForwardURI) {
    this.restorePhase = false;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));

    var curTree = sht.tree;
    var curNode, curEntry;
    for (var i = 0; i < sht.curPathPos; i++) {
      curNode = curTree[0];
      curEntry = curNode.entry;
      curTree = curNode.subtree;
    }

    if (curNode)
      curNode.entry = tabSt.entries[tabSt.index - 1];

    sht.curPathPos++;
    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));
    return true;
  },

  OnHistoryGotoIndex: function (aIndex, aGotoURI) {
    if (this.restorePhase) return true;
    this.restorePhase = false;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));

    var curTree = sht.tree;
    var curNode, curEntry;
    for (var i = 0; i < sht.curPathPos; i++) {
      curNode = curTree[0];
      curEntry = curNode.entry;
      curTree = curNode.subtree;
    }

    if (curNode)
      curNode.entry = tabSt.entries[tabSt.index - 1];
    sht.curPathPos = aIndex + 1;

    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));
    return true;
  },

  OnHistoryNewEntry: function (aNewURI) {
    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));
    if (this.restorePhase) {
      if (this.numIgnores == -1) this.numIgnores = sht.curPathLength;
      if (this.numIgnores > 0) {
        this.numIgnores--;
        return true;
      } else
        this.restorePhase = false;
    }

    var curTree = sht.tree;
    var curNode = null, curEntry = null;
    for (var i = 0; i < sht.curPathPos; i++) {
      curNode = curTree[0];
      curEntry = curNode.entry;
      curTree = curNode.subtree;
    }

    var curIndex = this.browser.sessionHistory.index;
    if (curNode)
      curNode.entry = tabSt.entries[curIndex];

    sht.curPathPos++;
    if (curNode && curTree.length)
      sht.curPathLength = sht.curPathPos;
    else if (curIndex == sht.curPathLength - 1)
      sht.curPathLength++;
    var newNode = {
      entry: { url: aNewURI.spec, title: "SHTInit", ID: null, scroll: "0,0" },
      subtree: []
    };
    curTree.unshift(newNode);
    var branchLimit = prefs.getIntPref("branchlimit");
    if (curTree.length > branchLimit) {
      let numDel = curTree.length - branchLimit;
      curTree.splice(-numDel, numDel);
    }

    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));

    var tab = this.tab, browser = this.browser;
    browser.addEventListener(
      "DOMContentLoaded",
      function __bclHandler () {
        var entry = JSON.parse(sStore.getTabState(tab)).entries[curIndex+1];
        newNode.entry = entry;
        sStore.setTabValue(tab, "sessionHistoryTree", JSON.stringify(sht));
        var domWin = browser.contentWindow;
        domWin.addEventListener(
          "load",
          function __wlHandler () {
            var entry =
              JSON.parse(sStore.getTabState(tab)).entries[curIndex+1];
            newNode.entry = entry;
            sStore.setTabValue(tab, "sessionHistoryTree", JSON.stringify(sht));
            domWin.removeEventListener("load", __wlHandler, false);
          },
          false);
        browser.removeEventListener("DOMContentLoaded", __bclHandler, false);
      },
      false);

    return true;
  },

  OnHistoryPurge: function (aNumEntries) {
    if (this.restorePhase) return true;
    log("Purge " + aNumEntries);
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));

    var curRoot = sht.tree;
    sht.curPathPos -= aNumEntries;
    for (var i = 0; i < aNumEntries; i++)
      curRoot = curRoot.reduce(
        function (prev, cur) prev.concat(cur.subtree), []);
    sht.tree = curRoot;

    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));
    return true;
  },

  OnHistoryReload: function (aReloadURI, aReloadFlags) true,
};

function getSHTFillHistoryMenu (aOldFHM)
  function (aParent) {
    var res = aOldFHM(aParent);
    if (!res) return false;

    var document = aParent.ownerDocument;
    var tab = document.defaultView.gBrowser.selectedTab;
    var grid = aParent.firstChild;
    if (grid && grid.tagName == "grid")
      aParent.removeChild(grid);
    grid = document.createElement("grid");
    var cols = document.createElement("columns");
    var col = document.createElement("column");
    col.setAttribute("flex", "1");
    cols.appendChild(col);
    col = document.createElement("column");
    cols.appendChild(col);
    grid.appendChild(cols);
    var rows = document.createElement("rows");

    var pathLen = aParent.firstChild.getAttribute("index");
    var path = [];
    for (var i = 0; i <= pathLen; i++) path.push(0);
    var multis = getSHTPathMultis(tab, pathLen);
    while (aParent.hasChildNodes()) {
      let row = document.createElement("row");
      let item = aParent.firstChild;
      item.setAttribute("shtpath", path.toString());
      path.pop();
      aParent.removeChild(item);
      row.appendChild(item);
      if (multis.pop()) {
        let sm = document.createElement("menu");
        sm.className = "menu-iconic sessionhistorytree-submenu";
        let smPopup = document.createElement("menupopup");
        smPopup.setAttribute("shtpath", path.toString());
        smPopup.addEventListener("popupshowing", fillTreeSubmenu, false);
        smPopup.addEventListener("command", switchPath, false);
        sm.appendChild(smPopup);
        row.appendChild(sm);
      }
      rows.appendChild(row);
    }
    grid.appendChild(rows);
    aParent.appendChild(grid);

    return true;
  };

function getSHTPathMultis (aTab, aEndIndex) {
  var sht = JSON.parse(sStore.getTabValue(aTab, "sessionHistoryTree"));
  var node = sht.tree[0];
  var multis = [sht.tree.length > 1];
  for (var i = 0; i < aEndIndex; i++) {
    if (node.subtree.length > 0) multis.push(node.subtree.length > 1);
    node = node.subtree[0];
  }
  return multis;
}

function fillTreeSubmenu (evt) {
  var popup = evt.target;
  var popupPathStr = popup.getAttribute("shtpath");
  if (popupPathStr == "")
    popupPath = [];
  else
    popupPath = popupPathStr.split(",");

  var document = popup.ownerDocument;
  var tab = document.defaultView.gBrowser.selectedTab;

  var ts = JSON.parse(sStore.getTabState(tab));
  var sht = JSON.parse(sStore.getTabValue(tab, "sessionHistoryTree"));
  var tree = sht.tree, node,
      isCurPath = (popupPath.length == sht.curPathPos - 1);
  for (var i = 0; i < popupPath.length; i++) {
    let pathIdx = popupPath[i];
    if (sht.curPathPos > i + 1 && pathIdx != 0)
      isCurPath = false;
    node = tree[popupPath[i]];
    tree = node.subtree;
  }

  while (popup.hasChildNodes())
    popup.removeChild(popup.lastChild);

  var grid = document.createElement("grid");
  var cols = document.createElement("columns");
  var col = document.createElement("column");
  col.setAttribute("flex", "1");
  cols.appendChild(col);
  col = document.createElement("column");
  cols.appendChild(col);
  grid.appendChild(cols);
  var rows = document.createElement("rows");

  var lastIdx;
  if (isCurPath)
    lastIdx = 0;
  else
    lastIdx = -1;

  for (i = 0; i < tree.length; i++) {
    node = tree[i];
    let entry;
    if (i == lastIdx) {
      entry = ts.entries[sht.curPathPos - 1];
      node.entry = entry;
      sStore.setTabValue(tab, "sessionHistoryTree", JSON.stringify(sht));
    } else
      entry = node.entry;

    let row = document.createElement("row");
    let item = document.createElement("menuitem");
    item.setAttribute("label", entry.title);
    item.setAttribute("uri", entry.url);
    item.setAttribute("tooltiptext",
                      strings.GetStringFromName("switchpath_tooltip"));
    let itemPath = popupPath.concat(i);
    item.setAttribute("shtpath", itemPath.toString());

    if (isCurPath && i == lastIdx) {
      item.setAttribute("type", "radio");
      item.setAttribute("checked", "true");
    } else {
      item.className = "menuitem-iconic";
      let uri = ioSvc.newURI(entry.url, null, null);
      let iconURL = faviconSvc.getFaviconForPage(uri).spec;
      item.style.listStyleImage = "url(" + iconURL + ")";
    }
    row.appendChild(item);

    if (node.subtree.length > 0) {
      let sm = document.createElement("menu");
      sm.className = "menu-iconic sessionhistorytree-submenu";
      let smPopup = document.createElement("menupopup");
      smPopup.setAttribute("shtpath", itemPath.toString());
      smPopup.addEventListener("popupshowing", fillTreeSubmenu, false);
      sm.appendChild(smPopup);
      row.appendChild(sm);
    }

    rows.appendChild(row);
  }
  grid.appendChild(rows);
  popup.appendChild(grid);

  evt.stopPropagation();
}

function switchPath (evt) {
  evt.stopPropagation();
  var item = evt.target, targetPath = item.getAttribute("shtpath").split(",");
  var window = item.ownerDocument.defaultView,
      browser = window.gBrowser.selectedBrowser,
      tab = window.gBrowser.selectedTab;
  var sht = JSON.parse(sStore.getTabValue(tab, "sessionHistoryTree"));
  var entries = [];
  var tree = sht.tree, node;
  for (var i = 0; i < targetPath.length; i++) {
    node = tree.splice(targetPath[i], 1)[0];
    tree.unshift(node);
    entries.push(node.entry);
    tree = node.subtree;
  }
  sht.curPathPos = i;
  sStore.setTabValue(tab, "sessionHistoryTree", JSON.stringify(sht));

  while (tree.length > 0) {
    node = tree[0];
    entries.push(node.entry);
    tree = node.subtree;
  }

  var ts = JSON.parse(sStore.getTabState(tab));
  ts.entries = entries;
  ts.index = i;
  sessionHistoryTree.sHistoryHandlers[window][browser].startRestorePhase();
  sStore.setTabState(tab, JSON.stringify(ts));
}
