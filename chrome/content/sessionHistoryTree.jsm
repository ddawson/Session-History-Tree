/*
    Session History Tree, extension for Firefox 4.0+
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
XPCOMUtils.defineLazyServiceGetter(
  this, "prefSvc", "@mozilla.org/preferences-service;1", "nsIPrefService");
XPCOMUtils.defineLazyGetter(
  this, "prefs", function ()
    prefSvc.getBranch("extensions.sessionhistorytree."));
XPCOMUtils.defineLazyGetter(
  this,
  "prefs2",
  function () {
    var prefs2 = prefSvc.getBranch("extensions.sessionhistorytree.");
    prefs2.QueryInterface(Ci.nsIPrefBranch2);
    return prefs2;
  });
XPCOMUtils.defineLazyGetter(
  this, "strings", function ()
    Cc["@mozilla.org/intl/stringbundle;1"].
    getService(Ci.nsIStringBundleService).
    createBundle("chrome://sessionhistorytree/locale/sht.properties"));

function log (aMsg) {
  if (prefs.getBoolPref("debug"))
    consoleSvc.logStringMessage("Session History Tree: " + aMsg);
}

function thisWrap (func, thisObj)
  function () func.apply(thisObj, arguments);

function el (aDoc, aId) aDoc.getElementById(aId)

var shortcutKey, shortcutKeycode, shortcutModifiers;
function convertModifiers (aModifiers) {
  shortcutModifiers = [];
  var keyElemModList = aModifiers.replace(" ", ",").split(",");
  [["control", "ctrlKey"], ["alt", "altKey"], ["meta", "metaKey"],
   ["shift", "shiftKey"]].forEach(function (e) {
    shortcutModifiers.push([e[1], (keyElemModList.indexOf(e[0]) != -1)]);
  });
}

function handleShortcut (evt) {
  if (shortcutKeycode != 0 ? evt.keyCode != shortcutKeycode
                           : String.fromCharCode(evt.charCode) != shortcutKey)
    return;
  if (!shortcutModifiers.every(function (e) evt[e[0]] == e[1])) return;
  el(evt.currentTarget.document,
     "toggle-sessionhistorytree-sidebar").doCommand();
}

var sessionHistoryTree = {
  nextWindowID: 0,
  nextBrowserID: 0,
  windows: [],
  sHistoryHandlers: {},
  treeChangeListeners: {},

  registerLoadHandler: function (win) {
    win.addEventListener(
      "load",
      function (evt) { sessionHistoryTree.windowLoadHandler(evt); },
      false);
    win.addEventListener(
      "unload",
      function (evt) { sessionHistoryTree.windowUnloadHandler(evt); },
      false);
  },

  windowLoadHandler: function __wlHandler (evt) {
    log("new window");
    var theWindow = evt.target.defaultView;
    this.giveNewWindowID(theWindow);
    this.windows.push(theWindow);
    var gBr = theWindow.gBrowser, tc = gBr.tabContainer;

    for (let i = 0; i < tc.itemCount; i++) {
      log("found a tab initially");
      let theTab = tc.getItemAtIndex(i),
          theBrowser = gBr.browsers[i];

      let callback = thisWrap(function () {
        log("initial tab loaded");
        try {
          var newSHHandler =
            new SHistoryHandler(theWindow, theTab, theBrowser);
        } catch (e if e.name == "NS_ERROR_ILLEGAL_VALUE") {
          return;
        }

        this.giveNewBrowserID(theWindow, theBrowser, newSHHandler);
        theTab.removeEventListener("load", callback, false);
      }, this);

      theTab.addEventListener("load", callback, false);
    }

    tc.addEventListener(
      "TabOpen",
      thisWrap(function (evt) {
          log("TabOpen");
          var theTab = evt.target, theBrowser = gBr.getBrowserForTab(theTab);
          var theWindow = theTab.ownerDocument.defaultView;
          var newSHHandler =
            new SHistoryHandler(theWindow, theTab, theBrowser);
          this.giveNewBrowserID(theWindow, theBrowser, newSHHandler);
        }, this),
      false);

    tc.addEventListener(
      "TabClose",
      thisWrap(function (evt) {
          log("TabClose");
          var theTab = evt.target, theBrowser = gBr.getBrowserForTab(theTab);
          var winID = theWindow.sessionHistoryTree_ID,
              brsID = theBrowser.sessionHistoryTree_ID;
          delete this.sHistoryHandlers[winID][brsID];
        }, this),
      false);

    tc.addEventListener(
      "TabSelect",
      thisWrap(function (evt) {
          log("TabSelect");
          this.notifyTreeChangeListeners(theWindow.sessionHistoryTree_ID);
        }, this),
      false);

    tc.addEventListener(
      "SSTabRestored",
      thisWrap(function (evt) {
          log("SSTabRestored");
          var winID = theWindow.sessionHistoryTree_ID;
          for each (let handler in this.sHistoryHandlers[winID])
            handler.endRestorePhase();
        }, this),
      false);

    theWindow.FillHistoryMenu =
      getSHTFillHistoryMenu(theWindow.FillHistoryMenu);

    var keyObj = el(theWindow.document,
                    "toggle-sessionhistorytree-sidebar-key");
    var key = prefs.getCharPref("sidebarkey"),
        modifiers = prefs.getCharPref("sidebarkeymodifiers");
    if (key.length <= 1) {
      keyObj.setAttribute("key", key);
      shortcutKey = key;
      shortcutKeycode = 0;
    } else {
      keyObj.setAttribute("keycode", "VK_" + key);
      shortcutKey = "";
      shortcutKeycode = prefs.getIntPref("sidebarkeycode");
    }
    keyObj.setAttribute("modifiers", modifiers);
    convertModifiers(modifiers);
    theWindow.addEventListener("keypress", handleShortcut, false);

    theWindow.removeEventListener("load", __wlHandler, false);
  },

  windowUnloadHandler: function __wuHandler (evt) {
    var windows = this.windows, theWindow = evt.target.defaultView;
    windows.splice(windows.indexOf(theWindow), 1);
    delete this.treeChangeListeners[theWindow.sessionHistoryTree_ID];
  },

  addTreeChangeListener: function (aWinID, aListener) {
    log("addTreeChangeListener " + aWinID);
    var ary = this.treeChangeListeners[aWinID];
    if (ary.indexOf(aListener) == -1) ary.push(aListener);
  },

  removeTreeChangeListener: function (aWinID, aListener) {
    log("removeTreeChangeListener " + aWinID);
    var ary = this.treeChangeListeners[aWinID];
    var idx = ary.indexOf(aListener);
    if (idx != -1) ary.splice(idx, 1);
  },

  notifyTreeChangeListeners: function (aWinID) {
    log("notifyTreeChangeListeners " + aWinID);
    this.treeChangeListeners[aWinID].forEach(function (l) {
      try {
        l.treeChangeNotify();
      } catch (e) {
        log("Warning: invalid or bad treeChangeNotify() function: " + e);
      }
    });
  },

  giveNewWindowID: function (aWindow) {
    var id = this.nextWindowID++;
    aWindow.sessionHistoryTree_ID = id;
    this.sHistoryHandlers[id] = {};
    this.treeChangeListeners[id] = [];
  },

  giveNewBrowserID: function (aWindow, aBrowser, aSHistoryHandler) {
    var winID = aWindow.sessionHistoryTree_ID,
        brsID = this.nextBrowserID++;
    aBrowser.sessionHistoryTree_ID = brsID;
    this.sHistoryHandlers[winID][brsID] = aSHistoryHandler;
  },

  clearTree: function (aWindow) {
    var winID = aWindow.sessionHistoryTree_ID;
    var brsID = aWindow.gBrowser.selectedBrowser.sessionHistoryTree_ID;
    this.sHistoryHandlers[winID][brsID].clearTree();
  },

  switchPath: function (aWindow, aBrowser, aTab, aTargetPath) {
    log("switchPath");
    var winID = aWindow.sessionHistoryTree_ID,
        brsID = aBrowser.sessionHistoryTree_ID;
    var sht = sessionHistoryTree.sHistoryHandlers[winID][brsID].sht;
    var entries = [];
    var tree = sht.tree, node;

    for (var i = 0; i < aTargetPath.length; i++) {
      node = tree.splice(aTargetPath[i], 1)[0];
      tree.unshift(node);
      entries.push(node.entry);
      tree = node.subtree;
    }

    sht.curPathPos = i - 1;
    sStore.setTabValue(aTab, "sessionHistoryTree",
                       JSON.stringify(sht));

    while (tree.length > 0) {
      node = tree[0];
      entries.push(node.entry);
      tree = node.subtree;
    }

    var ts = JSON.parse(sStore.getTabState(aTab));
    ts.entries = entries;
    ts.index = i;
    this.sHistoryHandlers[winID][brsID].startSwitchPhase();
    sStore.setTabState(aTab, JSON.stringify(ts));
  },

  openInTab: function (aWindow, aPath, aLoadInBG) {
    log("openInTab");
    var browser = aWindow.gBrowser.selectedBrowser,
        tab = aWindow.gBrowser.selectedTab,
        winID = aWindow.sessionHistoryTree_ID,
        brsID = browser.sessionHistoryTree_ID,
        sht = this.sHistoryHandlers[winID][brsID].sht,
        tree = sht.tree, node;

    for (var i = 0; i < aPath.length; i++) {
      node = tree[aPath[i]];
      tree = node.subtree;
    }

    var url = node.entry.url;
    aWindow.gBrowser.loadOneTab(
      url, { inBackground: aLoadInBG, relatedToCurrent: true });
  },

  _allZeros: function (aAry) {
    for (var i = 0; i < aAry.length; i++)
      if (aAry[i] != 0) return false;
    return true;
  },

  _rebuildSessionHistory: function (aTab, aSHT, aNewIndex, aWinID, aBrsID) {
    var tabSt = JSON.parse(sStore.getTabState(aTab)),
        entries = tabSt.entries = [];
        tree = aSHT.tree, node = null;

    var len = 0;
    while (tree.length > 0) {
      node = tree[0];
      len++;
      entries.push(node.entry);
      tree = node.subtree;
    }

    aSHT.curPathLength = len;
    sStore.setTabValue(aTab, "sessionHistoryTree",
                       JSON.stringify(aSHT));
    if (aNewIndex > 0) tabSt.index = aNewIndex;
    this.sHistoryHandlers[aWinID][aBrsID].startSwitchPhase();
    sStore.setTabState(aTab, JSON.stringify(tabSt));
  },

  _deleteSubtree: function (aWindow, aPath, aSHT, aTab, aBrowser) {
    var winID = aWindow.sessionHistoryTree_ID,
        brsID = aBrowser.sessionHistoryTree_ID,
        tree = aSHT.tree, node = null, parent;

    for (var i = 0; i < aPath.length; i++) {
      parent = node;
      node = tree[aPath[i]];
      tree = node.subtree;
    }

    var idx = aPath.length - 1;

    var moveUp = false;
    if (parent) {
      parent.subtree.splice(aPath[idx], 1);
      if (this._allZeros(aPath) && aSHT.curPathPos >= aPath.length - 1) {
        if (parent.subtree.length == 0)
          aPath.splice(idx, 1);
        aSHT.curPathPos = aPath.length - 1;
        moveUp = true;
      }
    } else
      aSHT.tree.splice(aPath[0], 1);

    this._rebuildSessionHistory(aTab, aSHT, moveUp ? aPath.length : 0,
                                winID, brsID);
    if (aWindow.gBrowser.selectedBrowser == aBrowser)
      this.notifyTreeChangeListeners(winID);
  },

  deleteSubtree: function (aWindow, aPath) {
    log("deleteSubtree");
    var gBr = aWindow.gBrowser, tab = gBr.selectedTab,
        browser = gBr.selectedBrowser,
        winID = aWindow.sessionHistoryTree_ID,
        brsID = browser.sessionHistoryTree_ID,
        sht = this.sHistoryHandlers[winID][brsID].sht;
    if (aPath.length == 1 && sht.tree.length == 1) return false;

    this._deleteSubtree(aWindow, aPath, sht, tab, browser);
    return true;
  },

  _createNewTabWithSubtree: function (aWindow, aPath, aLoadInBG) {
    var winID = aWindow.sessionHistoryTree_ID,
        gBr = aWindow.gBrowser, tab = gBr.selectedTab,
        brsID = gBr.selectedBrowser.sessionHistoryTree_ID,
        sht = this.sHistoryHandlers[winID][brsID].sht,
        tree = sht.tree, node = null;

    for (var i = 0; i < aPath.length; i++) {
      node = tree[aPath[i]];
      tree = node.subtree;
    }
    var newRootNode = node;

    var tabState = JSON.parse(sStore.getTabState(tab));
    var entries = [];
    while (node) {
      entries.push(node.entry);
      node = tree[0];
      tree = node ? node.subtree : null;
    }
    tabState.entries = entries;
    tabState.index = 1;

    var newSHT = {
      tree: [newRootNode],
      curPathPos: 0,
      curPathLength: tabState.entries.length
    };
    tabState.extData.sessionHistoryTree = JSON.stringify(newSHT);

    var newTab = gBr.addTab();
    sStore.setTabState(newTab, JSON.stringify(tabState));
  },

  cloneSubtree: function (aWindow, aPath, aLoadInBG) {
    log("cloneSubtree");
    this._createNewTabWithSubtree(aWindow, aPath, aLoadInBG);
  },

  detachSubtree: function (aWindow, aPath, aLoadInBG) {
    log("detachSubtree");
    var winID = aWindow.sessionHistoryTree_ID,
        gBr = aWindow.gBrowser,
        browser = gBr.selectedBrowser, brsID = browser.sessionHistoryTree_ID,
        sht = this.sHistoryHandlers[winID][brsID].sht;
    if (aPath.length == 1 && sht.tree.length == 1) return false;

    this._createNewTabWithSubtree(aWindow, aPath, aLoadInBG);
    var tab = gBr.selectedTab;
    this._deleteSubtree(aWindow, aPath, sht, tab, browser);
    return true;
  },

  observe: function (aSubject, aTopic, aData) {
    if (aTopic != "nsPref:changed") return;

    switch (aData) {
      case "sidebarkeymodifiers":
      case "sidebarkey":
        let key = prefs.getCharPref("sidebarkey");
        let modifiers = prefs.getCharPref("sidebarkeymodifiers");
        this.changeSidebarKey(key, modifiers);
        break;
    }
  },

  changeSidebarKey: function (aKey, aModifiers) {
    if (aKey.length <= 1) {
      shortcutKey = aKey;
      shortcutKeycode = 0;
    } else {
      shortcutKey = "";
      shortcutKeycode = prefs.getIntPref("sidebarkeycode");
    }
    convertModifiers(aModifiers);
    
    for each (var w in this.windows) {
      let keyObj = el(w.document, "toggle-sessionhistorytree-sidebar-key");
      keyObj.setAttribute("modifiers", aModifiers);
      if (aKey.length <= 1) {
        keyObj.removeAttribute("keycode");
        keyObj.setAttribute("key", aKey);
      } else {
        keyObj.removeAttribute("key");
        keyObj.setAttribute("keycode", "VK_" + aKey);
      }
      let miObj = el(w.document, "toggle-sessionhistorytree-sidebar-menuitem");
      miObj.removeAttribute("acceltext");
    }
  },
};

prefs2.addObserver("", sessionHistoryTree, false);

function SHistoryHandler (aWindow, aTab, aBrowser) {
  log("new SHistoryHandler");
  this.window = aWindow;
  this.winID = aWindow.sessionHistoryTree_ID;
  this.tab = aTab;
  this.browser = aBrowser;
  this.restorePhase = true;
  this.switchPhase = false;
  this._initTreeFromSessionStore();
  this.registerSelf();
  aBrowser.webProgress.addProgressListener(
    this,
    Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT
      | Ci.nsIWebProgress.NOTIFY_LOCATION);
  this.request = null;
  this.stopped = false;
}

SHistoryHandler.prototype = {
  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsISHistoryListener, Ci.nsIWebProgressListener,
    Ci.nsISupports, Ci.nsISupportsWeakReference]),

  registerSelf: function () {
    var sHist = this.browser.sessionHistory;
    try {
      sHist.removeSHistoryListener(this);
    } catch (e) {}
    sHist.addSHistoryListener(this);
  },

  startSwitchPhase: function () {
    log("startSwitchPhase (" + this.browser.contentDocument.title + ")");
    this.switchPhase = true;
  },

  endRestorePhase: function () {
    log("endRestorePhase (" + this.browser.contentDocument.title + ")");
    this.restorePhase = false;
    this.switchPhase = false;
    this.registerSelf();

    var shtStr = sStore.getTabValue(this.tab, "sessionHistoryTree");
    if (!shtStr)
      this._initTreeFromSessionStore();
    else
      this.sht = JSON.parse(shtStr);
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);
  },

  clearTree: function () {
    if (prefs.getBoolPref("promptonclear")) {
      let res = promptSvc.confirmEx(
        this.browser.contentWindow,
        strings.GetStringFromName("clearingtree_title"),
        strings.GetStringFromName("clearingtree_label"),
        promptSvc.BUTTON_POS_1_DEFAULT + promptSvc.STD_YES_NO_BUTTONS
        + promptSvc.BUTTON_TITLE_IS_STRING*promptSvc.BUTTON_POS_2, null,
          null, strings.GetStringFromName("clearingtree_always"), null, {});

      if (res == 1) return;
      if (res == 2)
        prefs.setBoolPref("promptonclear", false);
    }

    this._initTreeFromSessionStore();
    log("tree cleared");
  },

  _initTreeFromSessionStore: function () {
    log("_initTreeFromSessionStore");
    var st = JSON.parse(sStore.getTabState(this.tab));

    this.sht = {
      tree: [],
      curPathPos: st.index ? st.index - 1 : -1,
      curPathLength: st.entries.length
    };

    var tree = this.sht.tree;

    if (this.sht.curPathPos >= 0) {
      for (var i = 0; i < st.entries.length; i++) {
        let node = {
          entry: st.entries[i],
          subtree: []
        };
        tree.push(node);
        tree = node.subtree;
      }
    } else {
      tree.push({
        entry: { title: "about:blank", url: "about:blank" },
        subtree: [] });
      this.sht.curPathPos = 0;
      this.sht.curPathLength = 1;
    }

    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);
  },

  OnHistoryGoBack: function (aBackURI) {
    log("HistoryGoBack");
    this.switchPhase = false;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));

    this.sht.curPathPos = tabSt.index - 1;
    var curTree = this.sht.tree, curNode;

    for (var i = 0; i <= this.sht.curPathPos; i++) {
      curNode = curTree[0];
      curTree = curNode ? curNode.subtree : null;
    }

    if (curNode)
      curNode.entry = tabSt.entries[tabSt.index - 1];
    
    this.sht.curPathPos--;
    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);
    return true;
  },

  OnHistoryGoForward: function (aForwardURI) {
    log("HistoryGoForward");
    this.switchPhase = false;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));

    this.sht.curPathPos = tabSt.index - 1;
    var curTree = this.sht.tree, curNode;

    for (var i = 0; i <= this.sht.curPathPos; i++) {
      curNode = curTree[0];
      curTree = curNode ? curNode.subtree : null;
    }

    if (curNode)
      curNode.entry = tabSt.entries[tabSt.index - 1];

    this.sht.curPathPos++;
    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);
    return true;
  },

  OnHistoryGotoIndex: function (aIndex, aGotoURI) {
    log("HistoryGotoIndex");
    if (this.switchPhase) return true;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));

    this.sht.curPathPos = tabSt.index - 1;
    var curTree = this.sht.tree, curNode;

    for (var i = 0; i <= this.sht.curPathPos; i++) {
      curNode = curTree[0];
      curTree = curNode ? curNode.subtree : null;
    }

    if (curNode)
      curNode.entry = tabSt.entries[tabSt.index - 1];
    this.sht.curPathPos = aIndex;

    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);
    return true;
  },

  OnHistoryNewEntry: function (aNewURI) {
    log("HistoryNewEntry");
    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    if (this.switchPhase) return true;

    this.sht.curPathPos = tabSt.index - 1;
    var curTree = this.sht.tree, curNode = null;

    for (var i = 0; i <= this.sht.curPathPos; i++) {
      curNode = curTree[0];
      curTree = curNode ? curNode.subtree : null;
    }

    var curIndex = this.browser.sessionHistory.index;
    if (curNode)
      curNode.entry = tabSt.entries[curIndex];

    this.sht.curPathPos++;
    if (curNode && curTree.length)
      this.sht.curPathLength = this.sht.curPathPos + 1;
    else if (curIndex == this.sht.curPathLength - 1)
      this.sht.curPathLength++;

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

    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);

    var thisObj = this;
    this.browser.addEventListener(
      "DOMContentLoaded",
      function __dclHandler () {
        thisObj._dclHandler(curIndex + 1, newNode);
        thisObj.browser.removeEventListener(
          "DOMContentLoaded", __dclHandler, false)
      },
      false);

    return true;
  },

  OnHistoryPurge: function (aNumEntries) {
    log("HistoryPurge (" + aNumEntries + ")");
    if (this.switchPhase) return true;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));

    var curRoot = this.sht.tree;
    sht.curPathPos = tabSt.index - 1 - aNumEntries;

    for (var i = 0; i < aNumEntries; i++)
      curRoot = curRoot.reduce(
        function (prev, cur) prev.concat(cur.subtree), []);
    this.sht.tree = curRoot;

    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);
    return true;
  },

  OnHistoryReload: function (aReloadURI, aReloadFlags) {
    log("OnHistoryReload");

    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    this.sht.curPathPos = tabSt.index - 1;
    var curTree = this.sht.tree, curNode = null;

    for (var i = 0; i <= this.sht.curPathPos; i++) {
      curNode = curTree[0];
      curTree = curNode ? curNode.subtree : null;
    }

    var curIndex = this.browser.sessionHistory.index;
    if (curNode) curNode.entry = tabSt.entries[curIndex];
    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);

    var thisObj = this;
    this.browser.addEventListener(
      "DOMContentLoaded",
      function __dclHandler () {
        thisObj._dclHandler(curIndex, curNode);
        thisObj.browser.removeEventListener(
          "DOMContentLoaded", __dclHandler, false);
      },
      false);

    return true;
  },

  _dclHandler: function (curIndex, updateNode) {
    log("DOMContentLoaded");
    var entry = JSON.parse(sStore.getTabState(this.tab)).entries[curIndex];

    // Prevent recursion, as with about:sessionrestore
    if (entry.url.substring(0, 6)) {
      if (entry.hasOwnProperty("formdata"))
        delete entry.formdata;
    }

    updateNode.entry = entry;
    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);

    var tab = this.tab, sht = this.sht;
    var domWin = this.browser.contentWindow;

    this.browser.removeEventListener("DOMContentLoaded", this._dclHandler,
                                     false);
    if (this.stopped) return;

    var thisObj = this;
    domWin.addEventListener(
      "load",
      function __wlHandler () {
        log("load");
        var entry = JSON.parse(sStore.getTabState(tab)).entries[curIndex];
        updateNode.entry = entry;

        // Prevent recursion, as with about:sessionrestore
        if (entry.url.substring(0, 6)) {
          if (entry.hasOwnProperty("formdata"))
            delete entry.formdata;
        }

        sStore.setTabValue(tab, "sessionHistoryTree", JSON.stringify(sht));
        if (thisObj.window.gBrowser.selectedBrowser == thisObj.browser)
          sessionHistoryTree.notifyTreeChangeListeners(thisObj.winID);
        domWin.removeEventListener("load", __wlHandler, false);
      },
      false);
  },

  onLocationChange: function (aWebProgress, aRequest, aLocation) {
    try {
      log("LocationChange (" + aRequest.name + "): " + aLocation.spec);
    } catch (e) {
      log("LocationChange: " + aLocation.spec);
    }

    this.request = aRequest;
    this.stopped = false;

    if (this.restorePhase) return;

    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    this.sht.curPathPos = tabSt.index - 1;
    var curTree = this.sht.tree, curNode = null;

    for (var i = 0; i <= this.sht.curPathPos; i++) {
      curNode = curTree[0];
      curTree = curNode ? curNode.subtree : null;
    }

    var curIndex = this.browser.sessionHistory.index;
    if (curNode) curNode.entry = tabSt.entries[curIndex];
    sStore.setTabValue(this.tab, "sessionHistoryTree",
                       JSON.stringify(this.sht));
    if (this.window.gBrowser.selectedBrowser == this.browser)
      sessionHistoryTree.notifyTreeChangeListeners(this.winID);
  },

  onStateChange: function (aWebProgress, aRequest, aStateFlags, aStatus) {
    // 0x804b0002
    try {
      log("StateChange (" + aRequest.name + "): "
          + aStateFlags + ", " + aStatus);
    } catch (e) {
      log("StateChange : " + aStateFlags + ", " + aStatus);
    }

    if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      this.request = null;
      if (aStatus == 0x804b0002) {  // Is that value documented anywhere?
        log("stopped");
        this.stopped = true;
      }
    }
  },
};

function getSHTFillHistoryMenu (aOldFHM)
  function (aParent) {
    var children = aParent.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i].tagName == "hbox")
        aParent.removeChild(children[i]);
    }

    if (!prefs.getBoolPref("augmentbackforwardmenu")) return aOldFHM(aParent);
    log("FillHistoryMenu");
    var res = aOldFHM(aParent);
    if (!res) return false;

    var document = aParent.ownerDocument;
    var tab = document.defaultView.gBrowser.selectedTab;

    var pathLen = aParent.firstChild.getAttribute("index");
    var path = [];
    for (var i = 0; i <= pathLen; i++) path.push(0);
    var multis = getSHTPathMultis(tab, pathLen);

    for (let i = 0; i < children.length; i++) {
      let item = children[i];
      item.className += " sessionhistorytree-item";
      item.setAttribute("flex", "1");
      item.setAttribute("shtpath", path.toString());
      path.pop();

      if (multis.pop()) {
        let hbox = document.createElement("hbox");
        aParent.replaceChild(hbox, item);
        hbox.appendChild(item);
        let sm = document.createElement("menu");
        sm.className = "menu-iconic sessionhistorytree-submenu";
        let smPopup = document.createElement("menupopup");
        smPopup.setAttribute("shtpath", path.toString());
        smPopup.addEventListener("popupshowing", fillTreeSubmenu, false);
        smPopup.addEventListener("command", switchPath, false);
        smPopup.addEventListener("click", clickHandler, false);
        sm.appendChild(smPopup);
        hbox.appendChild(sm);
      }
    }

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
  log("fillTreeSubmenu");
  var popup = evt.target;
  var popupPathStr = popup.getAttribute("shtpath");

  if (popupPathStr == "")
    var popupPath = [];
  else
    var popupPath = popupPathStr.split(",");

  var document = popup.ownerDocument, window = document.defaultView,
      tab = window.gBrowser.selectedTab,
      browser = window.gBrowser.selectedBrowser,
      winID = window.sessionHistoryTree_ID,
      brsID = browser.sessionHistoryTree_ID;

  var ts = JSON.parse(sStore.getTabState(tab));
  var sht = sessionHistoryTree.sHistoryHandlers[winID][brsID].sht;
  var tree = sht.tree, node,
      isCurPath = (popupPath.length == sht.curPathPos);

  for (var i = 0; i < popupPath.length; i++) {
    let pathIdx = popupPath[i];
    if (sht.curPathPos > i && pathIdx != 0)
      isCurPath = false;
    node = tree[popupPath[i]];
    tree = node.subtree;
  }

  while (popup.hasChildNodes())
    popup.removeChild(popup.lastChild);

  var lastIdx;
  if (isCurPath)
    lastIdx = 0;
  else
    lastIdx = -1;

  for (i = 0; i < tree.length; i++) {
    node = tree[i];
    let entry;

    if (i == lastIdx) {
      entry = ts.entries[sht.curPathPos];
      node.entry = entry;
      sStore.setTabValue(tab, "sessionHistoryTree", JSON.stringify(sht));
    } else
      entry = node.entry;

    let item = document.createElement("menuitem");
    popup.appendChild(item);
    item.setAttribute("label", entry.title || entry.url);
    item.setAttribute("uri", entry.url);
    item.setAttribute("tooltiptext",
                      strings.GetStringFromName("switchpath_tooltip"));
    let itemPath = popupPath.concat(i);
    item.className = "sessionhistorytree-item";
    item.setAttribute("flex", "1");
    item.setAttribute("shtpath", itemPath.toString());

    if (isCurPath && i == lastIdx) {
      item.setAttribute("type", "radio");
      item.setAttribute("checked", "true");
    } else {
      item.className += " menuitem-iconic";
      let uri = ioSvc.newURI(entry.url, null, null);

      try {
        let iconURL = faviconSvc.getFaviconForPage(uri).spec;
        item.style.listStyleImage = "url(" + iconURL + ")";
      } catch (e) {}
    }

    if (node.subtree.length > 0) {
      let hbox = document.createElement("hbox");
      popup.replaceChild(hbox, item);
      hbox.appendChild(item);
      let sm = document.createElement("menu");
      sm.className = "menu-iconic sessionhistorytree-submenu";
      let smPopup = document.createElement("menupopup");
      smPopup.setAttribute("shtpath", itemPath.toString());
      smPopup.addEventListener("popupshowing", fillTreeSubmenu, false);
      sm.appendChild(smPopup);
      hbox.appendChild(sm);
    }
  }

  evt.stopPropagation();
}

function switchPath (evt) {
  evt.stopPropagation();
  var item = evt.target, targetPath = item.getAttribute("shtpath").split(",");
  var window = item.ownerDocument.defaultView;
  var browser = window.gBrowser.selectedBrowser,
      tab = window.gBrowser.selectedTab;
  sessionHistoryTree.switchPath(window, browser, tab, targetPath);
}

function clickHandler (evt) {
  if (evt.button != 1 && !evt.ctrlKey) return;
  evt.stopPropagation();

  var item = evt.target, targetPath = item.getAttribute("shtpath").split(",");
  var window = item.ownerDocument.defaultView;
  var loadInBG = prefSvc.getBranch("").getBoolPref(
    "browser.tabs.loadBookmarksInBackground");
  if (evt.shiftKey) loadInBG = !loadInBG;
  
  var mode = prefs.getIntPref("middleclickmode");
  switch (mode) {
    case 0:
      sessionHistoryTree.openInTab(window, targetPath, loadInBG);
      break;

    case 1:
      // To be implemented
      break;

    case 2:
      // To be implemented
      break;
  }
}
