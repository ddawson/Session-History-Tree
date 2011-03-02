/*
    Session History Tree, extension for Firefox 3.5+
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

const Cc = Components.classes, Ci = Components.interfaces,
      Cr = Components.results;
var sStore = Cc["@mozilla.org/browser/sessionstore;1"].
             getService(Ci.nsISessionStore);
var consoleSvc = Cc["@mozilla.org/consoleservice;1"].
                 getService(Ci.nsIConsoleService);

var EXPORTED_SYMBOLS = ["sessionHistoryTree"];

function thisWrap (func, thisObj)
  function () func.apply(thisObj, arguments);

var sessionHistoryTree = {
  registerLoadHandler: function (win) {
    win.addEventListener(
      "load", sessionHistoryTree.windowLoadHandler, false);
  },

  windowLoadHandler: function __wlHandler (evt) {
    var theWindow = evt.target.defaultView;
    sessionHistoryTree.sHistoryHandlers = {};
    var gBr = theWindow.gBrowser, tc = gBr.tabContainer;
    for (let i = 0; i < tc.itemCount; i++) {
      let theTab = tc.getItemAtIndex(i),
          theBrowser = gBr.browsers[i];
      let callback = thisWrap(function () {
        this.initTree(theTab, theBrowser);
        let newSHHandler = new SHistoryHandler(theTab, theBrowser);
        this.sHistoryHandlers[theBrowser] = newSHHandler;
        theBrowser.sessionHistory.addSHistoryListener(newSHHandler);
        theTab.removeEventListener("load", callback, false);
      }, sessionHistoryTree);
      theTab.addEventListener("load", callback, false);
    }

    tc.addEventListener(
      "TabOpen",
      thisWrap(function (evt) {
          var theTab = evt.target, theBrowser = gBr.getBrowserForTab(theTab);
          this.initTree(theTab, theBrowser);
          let newSHHandler = new SHistoryHandler(theTab, theBrowser);
          this.sHistoryHandlers[theBrowser] = newSHHandler;
          theBrowser.sessionHistory.addSHistoryListener(newSHHandler);
        }, sessionHistoryTree),
      false);

    tc.addEventListener(
      "TabClose",
      thisWrap(function (evt) {
          delete this.sHistoryHandlers[gBr.getBrowserForTab(evt.target)];
        }, sessionHistoryTree),
      false);

    theWindow.removeEventListener("load", __wlHandler, false);
  },

  initTree: function (theTab, theBrowser) {
    var curSHTStr = sStore.getTabValue(theTab, "sessionHistoryTree");
    if (!curSHTStr) {
      //let curStateObj = JSON.parse(sStore.getTabState(theTab));
      let newSHTObj = {
        tree: [],
        curPath: [],
        curPathLength: 0
      };
      sStore.setTabValue(theTab, "sessionHistoryTree",
                         JSON.stringify(newSHTObj));
    }
  },
};

function SHistoryHandler (aTab, aBrowser) {
  this.tab = aTab;
  this.browser = aBrowser;
  this.restorePhase = true;
  this.numIgnores = -1;
}

SHistoryHandler.prototype = {
  QueryInterface: function (aIID) {
    if (aIID.equals(Ci.nsISHistoryListener) || aIID.equals(Ci.nsISupports)
          || aIID.equals(Ci.nsISupportsWeakReference))
      return this;
    else
      throw Cr.NS_ERROR_NO_INTERFACE;
  },

  OnHistoryGoBack: function (aBackURI) {
    this.restorePhase = false;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));

    var curTree = sht.tree;
    var curNode, curEntry;
    for each (i in sht.curPath) {
      curNode = curTree[i];
      curEntry = curNode.entry;
      curTree = curNode.subtree;
    }

    if (curNode)
      curNode.entry = tabSt.entries[tabSt.index - 1];
    
    sht.curPath.pop();
    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));
    return true;
  },

  OnHistoryGoForward: function (aForwardURI) {
    this.restorePhase = false;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));

    var curTree = sht.tree;
    var curNode, curEntry;
    for each (i in sht.curPath) {
      curNode = curTree[i];
      curEntry = curNode.entry;
      curTree = curNode.subtree;
    }

    if (curNode)
      curNode.entry = tabSt.entries[tabSt.index - 1];

    sht.curPath.push(curNode.curSubtreeIndex);
    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));
    return true;
  },

  OnHistoryGotoIndex: function (aIndex, aGotoURI) {
    this.restorePhase = false;
    var tabSt = JSON.parse(sStore.getTabState(this.tab));
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));

    var curTree = sht.tree;
    var curNode, curEntry;
    for each (i in sht.curPath) {
      curNode = curTree[i];
      curEntry = curNode.entry;
      curTree = curNode.subtree;
    }

    var curIndex = tabSt.index - 1;
    if (curNode)
      curNode.entry = tabSt.entries[curIndex];

    if (aIndex < curIndex) {          // going back
      for (let i = curIndex; i > aIndex; i--)
        sht.curPath.pop();
    } else if (aIndex > curIndex) {   // going forward
      for (let i = curIndex; i < aIndex; i++) {
        let nextIndex = curNode.curSubtreeIndex,
            curNode = curTree[nextIndex];
        sht.curPath.push(nextIndex);
      }
    }

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
        consoleSvc.logStringMessage(
          "Ignoring new entry, " + this.numIgnores + " to go");
        return true;
      } else
        this.restorePhase = false;
    }

    var curTree = sht.tree;
    var curNode = null, curEntry = null;
    for each (i in sht.curPath) {
      curNode = curTree[i];
      curEntry = curNode.entry;
      curTree = curNode.subtree;
    }

    var curIndex = this.browser.sessionHistory.index;
    if (curNode)
      curNode.entry = tabSt.entries[curIndex];

    sht.curPath.push(curTree.length);
    if (curNode && curTree.length) {
      curNode.curSubtreeIndex++;
      sht.curPathLength = sht.curPath.length;
    } else if (curIndex == sht.curPathLength - 1)
      sht.curPathLength++;
    curTree.push({
      entry: { url: aNewURI.spec, title: null, ID: null, scroll: "0,0" },
      curSubtreeIndex: 0,
      subtree: [] });

    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));
    return true;
  },

  OnHistoryPurge: function (aNumEntries) {
    consoleSvc.logStringMessage("Purge " + aNumEntries);
    var sht = JSON.parse(sStore.getTabValue(this.tab, "sessionHistoryTree"));

    var curRoot = sht.tree, curPathIndex = sht.curPath[0];
    for (var i = 0; i < aNumEntries; i++) {
      let newRoot = curRoot.slice(0, curPathIndex).reduce(
        function (prev, cur) prev.concat(cur), []);
      sht.curPath.shift(1);
      curPathIndex = sht.curPath[0] += curPathIndex;
    }

    sStore.setTabValue(this.tab, "sessionHistoryTree", JSON.stringify(sht));
    return true;
  },

  OnHistoryReload: function (aReloadURI, aReloadFlags) true,
};
