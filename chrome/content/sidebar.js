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

const Cu = Components.utils, Ci = Components.interfaces;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://sessionhistorytree/sessionHistoryTree.jsm");

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
  this, "strings", function ()
    el("sidebar-strings").stringBundle);

function el (aId) document.getElementById(aId);

var navigation = {
  popupIsShown: false,
  mutex: 0,
  notified: false,

  loadHandler: function () {
    sessionHistoryTree.addTreeChangeListener(
      window.parent.sessionHistoryTree_ID, this);
    this.treeChangeNotify();
  },

  unloadHandler: function () {
    sessionHistoryTree.removeTreeChangeListener(
      window.parent.sessionHistoryTree_ID, this);
  },

  treeChangeNotify: function () {
    this.notified = true;

    for each (let x in ["top", "bottom"]) {
      for each (let y in ["left", "center", "right"]) {
        let col = el(x+"-"+y+"-column");
        while (col.hasChildNodes()) col.removeChild(col.firstChild);
      }
    }

    this.sht = JSON.parse(sStore.getTabValue(
      window.parent.gBrowser.tabContainer.selectedItem, "sessionHistoryTree"));
    this.curPathPos = this.sht.curPathPos;

    this.rtl =
      (window.getComputedStyle(document.documentElement).direction == "rtl");
    var col = el("top-center-column");
    var tree = this.sht.tree;
    var navPath = [];
    for (let i = 0; i < this.curPathPos; i++) {
      var node = tree[0];
      navPath.push(0);
      var hbox = this._createItem(node.entry, navPath, false, false);
      col.appendChild(hbox);
      tree = node.subtree;
    }

    col = el("bottom-center-column");
    var rCol = el("bottom-right-column");
    node = tree[0];
    var rNavPath = navPath.concat(1);
    this.curPagePos = navPath.length;
    navPath.push(0);
    var sel_hbox = this._createItem(node.entry, navPath, true, false);
    sel_hbox.classList.add("selected-cell");
    col.appendChild(sel_hbox);

    for (let rNode = tree[1], rTree;
         rNode;
         rTree = rNode.subtree, rNode = rTree[0]) {
      hbox = this._createItem(rNode.entry, rNavPath, false, true);
      rCol.appendChild(hbox);
      rNavPath.push(0);
    }

    tree = node.subtree;
    for (node = tree[0]; node; tree = node.subtree, node = tree[0]) {
      navPath.push(0);
      hbox = this._createItem(node.entry, navPath, false, false);
      col.appendChild(hbox);
    }
    this.curPath = navPath;

    var bd = el("bottom-div");
    var sh_top = bd.offsetTop,
        sh_bot = sh_top + sel_hbox.scrollHeight - 1,
        sh_mid = Math.floor((sh_top + sh_bot)/2),
        nb = el("navigation-box"),
        nb_height = nb.clientHeight,
        gb = sh_top + bd.scrollHeight,
        idealScrollPos = Math.floor(sh_mid - nb_height/2),
        maxScrollPos = gb - nb_height,
        actualScrollPos = idealScrollPos < maxScrollPos ? idealScrollPos
                                                        : maxScrollPos;
    nb.boxObject.QueryInterface(Ci.nsIScrollBoxObject).
      scrollTo(0, actualScrollPos);
  },

  _createItem: function (aEntry, aPath, aIsCurrent, aHideTitle) {
    var hbox = document.createElement("hbox");
    hbox.setAttribute("path", aPath);
    hbox.setAttribute("index", aPath.length - 1);
    hbox.addEventListener(
      "mouseover",
      this.makeMouseoverHandler(aPath.length - 1),
      false);
    hbox.addEventListener("click", this.clickHandler, false);

    var image = document.createElement("image");
    image.classList.add("icon-image");
    var uri = ioSvc.newURI(aEntry.url, null, null);
    try {
      var iconURL = faviconSvc.getFaviconForPage(uri).spec;
      image.setAttribute("src", iconURL);
    } catch (e) {}
    hbox.appendChild(image);

    var label = document.createElement("label");
    var val = aEntry.title || aEntry.url;
    label.setAttribute("value", val);
    label.setAttribute("tooltiptext", val);
    label.setAttribute("uri", aEntry.url);
    if (aIsCurrent) label.classList.add("current-page-label");
    if (aHideTitle) label.hidden = "true";
    hbox.appendChild(label);
    return hbox;
  },

  makeMouseoverHandler: function (aIdx)
    function (evt) { navigation.selectItem(aIdx); },

  clickHandler: function (evt) {
    switch (evt.button) {
      case 0:  // left
        let obj = evt.target;
        while (obj.tagName != "column") obj = obj.parentNode;
        if (obj.id == "bottom-left-column")
          navigation.selectPrevBranch();
        else if (obj.id == "bottom-right-column")
          navigation.selectNextBranch();
        else {
          if (evt.ctrlKey) {
            let mode = prefs.getIntPref("middleclickmode");
            let invertBGMode = evt.shiftKey;
            switch (mode) {
              case 0:
                navigation.openSelectedInTab(invertBGMode);
                break;

              case 1:
                navigation.cloneSelectedSubtree(invertBGMode);
                break;

              case 2:
                navigation.detachSelectedSubtree(invertBGMode);
                break;
            }
          } else
            navigation.visitSelected();
        }
        break;

      case 1:  // middle
        let mode = prefs.getIntPref("middleclickmode");
        let invertBGMode = evt.shiftKey;
        switch (mode) {
          case 0:
            navigation.openSelectedInTab(invertBGMode);
            break;

          case 1:
            navigation.cloneSelectedSubtree(invertBGMode);
            break;

          case 2:
            navigation.detachSelectedSubtree(invertBGMode);
            break;
        }
        break;
    }
  },

  selectPrev: function (aNum) {
    if (this.mutex > 0) return;

    var tcc = el("top-center-column");
    if (!tcc.hasChildNodes()) return;
    var bcc = el("bottom-center-column"),
        blc = el("bottom-left-column"), brc = el("bottom-right-column");

    while (blc.hasChildNodes()) blc.removeChild(blc.firstChild);
    while (brc.hasChildNodes()) brc.removeChild(brc.firstChild);
    this.curPathPos -= aNum;
    var tree = this.sht.tree;
    for (var i = 0; i < this.curPathPos; i++) {
      var node = tree[this.curPath[i]];
      tree = node.subtree;
    }
    var lastPathIdx = this.curPath[i];

    var oldSelItem = bcc.firstChild;
    for (i = 0; i < aNum; i++)
      bcc.insertBefore(tcc.lastChild, bcc.firstChild);
    var newSelItem = bcc.firstChild;
    newSelItem.classList.add("selected-cell");
    oldSelItem.classList.remove("selected-cell");
    var entry, path = this.curPath.slice(0, this.curPathPos)

    var lPath = path.concat(lastPathIdx - 1), lTree;
    var zeroPath = lPath.every(function (e) e == 0);
    for (node = tree[lastPathIdx - 1];
         node;
         lTree = node.subtree, node = lTree[0]) {
      let curPage = false;
      if (zeroPath && lPath.length - 1 == this.curPagePos) curPage = true;
      blc.appendChild(this._createItem(node.entry, lPath, curPage, true));
      lPath.push(0);
    }

    path.push(lastPathIdx + 1);
    for (node = tree[lastPathIdx + 1];
         node;
         tree = node.subtree, node = tree[0]) {
      brc.appendChild(this._createItem(node.entry, path, false, true));
      path.push(0);
    }

    var nb = el("navigation-box"), sh_top = el("bottom-div").offsetTop;
    if (nb.scrollTop > sh_top)
      nb.boxObject.QueryInterface(Ci.nsIScrollBoxObject).scrollTo(0, sh_top);
  },

  selectNext: function (aNum) {
    if (this.mutex > 0) return;

    var tcc = el("top-center-column"), bcc = el("bottom-center-column");
    if (bcc.childNodes.length == 1) return;
    var blc = el("bottom-left-column"), brc = el("bottom-right-column");

    while (blc.hasChildNodes()) blc.removeChild(blc.firstChild);
    while (brc.hasChildNodes()) brc.removeChild(brc.firstChild);
    this.curPathPos += aNum;
    var tree = this.sht.tree;
    for (var i = 0; i < this.curPathPos; i++) {
      var node = tree[this.curPath[i]];
      tree = node.subtree;
    }
    var lastPathIdx = this.curPath[i];

    var oldSelItem = bcc.firstChild;
    for (i = 0; i < aNum; i++) tcc.appendChild(bcc.firstChild);
    var newSelItem = bcc.firstChild;
    newSelItem.classList.add("selected-cell");
    oldSelItem.classList.remove("selected-cell");
    var entry, path = this.curPath.slice(0, this.curPathPos);

    var lPath = path.concat(lastPathIdx - 1), lTree;
    var zeroPath = lPath.every(function (e) e == 0);
    for (node = tree[lastPathIdx - 1];
         node;
         lTree = node.subtree, node = lTree[0]) {
      let curPage = false;
      if (zeroPath && lPath.length - 1 == this.curPagePos) curPage = true;
      blc.appendChild(this._createItem(node.entry, lPath, curPage, true));
      lPath.push(0);
    }

    path.push(lastPathIdx + 1);
    for (node = tree[lastPathIdx + 1];
         node;
         tree = node.subtree, node = tree[0]) {
      entry = node.entry;
      brc.appendChild(this._createItem(entry, path, false, true));
      path.push(0);
    }

    var nb = el("navigation-box"),
        sh_bot = el("bottom-div").offsetTop + newSelItem.scrollHeight;
    if (nb.scrollTop + nb.clientHeight < sh_bot)
      nb.boxObject.QueryInterface(Ci.nsIScrollBoxObject).
        scrollTo(0, sh_bot - nb.clientHeight);
  },

  selectItem: function (aIdx) {
    var oldIdx = this.curPathPos;
    if (aIdx < oldIdx)
      this.selectPrev(oldIdx - aIdx);
    else if (aIdx > oldIdx)
      this.selectNext(aIdx - oldIdx);
  },

  selectLeft: function () {
    if (this.rtl)
      this.selectNextBranch();
    else
      this.selectPrevBranch();
  },

  selectRight: function () {
    if (this.rtl)
      this.selectPrevBranch();
    else
      this.selectNextBranch();
  },

  selectPrevBranch: function () {
    var lc = el("bottom-left-column"),
        cc = el("bottom-center-column"),
        rc = el("bottom-right-column");
    if (!lc.hasChildNodes()) return;

    var thisObj = this;
    function endanimation () {
      var grid = el("navigation-bottom-grid");
      grid.classList.remove("shifted");
      grid.classList.remove("slide");
      grid.removeEventListener("transitionend", endanimation, false);

      thisObj.mutex--;
    }

    this.mutex++;
    if (this.mutex > 1) {
      this.mutex--;
      return;
    }
    this.notified = false;

    while (rc.hasChildNodes()) rc.removeChild(rc.firstChild);
    while (cc.hasChildNodes()) cc.removeChild(cc.firstChild);
    while (lc.hasChildNodes()) {
      let cell = lc.firstChild;
      cell.lastChild.hidden = false;
      cc.appendChild(cell);
    }
    cc.firstChild.classList.add("selected-cell");

    this.curPath[this.curPathPos]--;
    this.curPath.splice(this.curPathPos + 1, this.curPath.length);
    for (var i = 0; i < cc.childNodes.length - 1; i++)
      this.curPath.push(0);

    var tree = this.sht.tree;
    for (var i = 0; i < this.curPathPos; i++) {
      var node = tree[this.curPath[i]];
      tree = node.subtree;
    }

    var lPath =
      this.curPath.slice(0, this.curPathPos).
      concat(this.curPath[this.curPathPos] - 1)
    node = tree[lPath[this.curPathPos]];
    var zeroPath = lPath.every(function (e) e == 0);
    while (node) {
      let curPage = false;
      if (zeroPath && lPath.length - 1 == this.curPagePos) curPage = true;
      lc.appendChild(this._createItem(node.entry, lPath, curPage, true));
      lPath.push(0);
      let tree = node.subtree;
      node = tree[0];
    }

    var rPath =
      this.curPath.slice(0, this.curPathPos).
      concat(this.curPath[this.curPathPos] + 1)
    node = tree[rPath[this.curPathPos]];
    while (node) {
      rc.appendChild(this._createItem(node.entry, rPath, false, true));
      rPath.push(0);
      tree = node.subtree;
      node = tree[0];
    }

    if (!prefs.getBoolPref("sidebaranimations")) {
      endanimation();
      return;
    }

    var sheets = document.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      if (sheet.href == "chrome://sessionhistorytree/skin/sidebar.css") break;
    }

    var rules = sheet.cssRules, shiftedRule, slideRule;
    for (let i = 0; i < rules.length; i++) {
      let rule = rules[i];
      if (rule.type == CSSRule.STYLE_RULE
          && rule.selectorText == ".shifted") shiftedRule = rule;
      if (rule.type == CSSRule.STYLE_RULE
          && rule.selectorText == ".slide") slideRule = rule;
    }

    var columnWidth =
      window.getComputedStyle(el("bottom-center-column")).width;
    shiftedRule.style.setProperty(
      "left", (this.rtl ? "" : "-") + columnWidth, "");
    slideRule.style.setProperty("left", "0px", "");
    var grid = el("navigation-bottom-grid");
    grid.addEventListener("transitionend", endanimation, false);
    grid.classList.add("shifted");
    window.setTimeout(function () { grid.classList.add("slide"); }, 0);
  },

  selectNextBranch: function () {
    var lc = el("bottom-left-column"),
        cc = el("bottom-center-column"),
        rc = el("bottom-right-column");
    if (!rc.hasChildNodes()) return;

    var thisObj = this;
    function endanimation () {
      var grid = el("navigation-bottom-grid");
      grid.classList.remove("slide");
      grid.removeEventListener("transitionend", endanimation, false);

      if (thisObj.notified) {
        thisObj.mutex--;
        return;
      }

      while (cc.hasChildNodes()) cc.removeChild(cc.firstChild);
      while (rc.hasChildNodes()) {
        let cell = rc.firstChild;
        cell.lastChild.hidden = false;
        cc.appendChild(cell);
      }
      cc.firstChild.classList.add("selected-cell");

      thisObj.curPath[thisObj.curPathPos]++;
      thisObj.curPath.splice(thisObj.curPathPos + 1, thisObj.curPath.length);
      for (var i = 0; i < cc.childNodes.length - 1; i++)
        thisObj.curPath.push(0);

      var tree = thisObj.sht.tree;
      for (var i = 0; i < thisObj.curPathPos; i++) {
        var node = tree[thisObj.curPath[i]];
        tree = node.subtree;
      }

      var lPath =
        thisObj.curPath.slice(0, thisObj.curPathPos).
        concat(thisObj.curPath[thisObj.curPathPos] - 1)
      node = tree[lPath[thisObj.curPathPos]];
      var zeroPath = lPath.every(function (e) e == 0);
      while (node) {
        let curPage = false;
        if (zeroPath && lPath.length - 1 == thisObj.curPagePos) curPage = true;
        lc.appendChild(thisObj._createItem(node.entry, lPath, curPage, true));
        lPath.push(0);
        let tree = node.subtree;
        node = tree[0];
      }

      var rPath =
        thisObj.curPath.slice(0, thisObj.curPathPos).
        concat(thisObj.curPath[thisObj.curPathPos] + 1)
      node = tree[rPath[thisObj.curPathPos]];
      while (node) {
        rc.appendChild(thisObj._createItem(node.entry, rPath, false, true));
        rPath.push(0);
        tree = node.subtree;
        node = tree[0];
      }

      thisObj.mutex--;
    }

    this.mutex++;
    if (this.mutex > 1) {
      this.mutex--;
      return;
    }
    this.notified = false;

    while (lc.hasChildNodes()) lc.removeChild(lc.firstChild);
    if (!prefs.getBoolPref("sidebaranimations")) {
      endanimation();
      return;
    }

    var sheets = document.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      if (sheet.href == "chrome://sessionhistorytree/skin/sidebar.css") break;
    }

    var rules = sheet.cssRules;
    for (let i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.type == CSSRule.STYLE_RULE
          && rule.selectorText == ".slide") break;
    }

    var columnWidth =
      window.getComputedStyle(el("bottom-center-column")).width;
    rule.style.setProperty("left", (this.rtl ? "" : "-") + columnWidth, "");
    var grid = el("navigation-bottom-grid");
    var thisObj = this;
    grid.addEventListener("transitionend", endanimation, false);
    grid.classList.add("slide");
  },

  popupShown: function () { this.popupIsShown = true; },
  popupHidden: function () { this.popupIsShown = false; },

  visitSelected: function () {
    if (this.mutex > 0) return;

    var pWindow = window.parent, browser = pWindow.gBrowser.selectedBrowser,
        tab = pWindow.gBrowser.selectedTab;
    sessionHistoryTree.switchPath(
      pWindow, browser, tab,
      el("bottom-center-column").firstChild.getAttribute("path").split(","));
  },

  deleteSelectedSubtree: function () {
    if (prefs.getBoolPref("promptondeletesubtree")) {
      let res = promptSvc.confirmEx(
        window,
        strings.GetStringFromName("deletingsubtree.title"),
        strings.GetStringFromName("deletingsubtree.text"),
        promptSvc.BUTTON_POS_1_DEFAULT + promptSvc.STD_YES_NO_BUTTONS
        + promptSvc.BUTTON_TITLE_IS_STRING*promptSvc.BUTTON_POS_2, null,
        null, strings.GetStringFromName("deletingsubtree.always"), null, {});

      if (res == 1) return;
      if (res == 2)
        prefs.setBoolPref("promptondeletesubtree", false);
    }

    var path = el("bottom-center-column").firstChild.getAttribute("path").
      split(",");
    sessionHistoryTree.deleteSubtree(window.parent, path);
  },

  openSelectedInTab: function (aInvertBGMode) {
    var loadInBG = prefSvc.getBranch("").getBoolPref(
      "browser.tabs.loadBookmarksInBackground");
    if (aInvertBGMode) loadInBG = !loadInBG;
    var path = el("bottom-center-column").firstChild.getAttribute("path").
      split(",");
    sessionHistoryTree.openInTab(window.parent, path, loadInBG);
  },

  cloneSelectedSubtree: function (aInvertBGMode) {
    var loadInBG = prefSvc.getBranch("").getBoolPref(
      "browser.tabs.loadBookmarksInBackground");
    if (aInvertBGMode) loadInBG = !loadInBG;
    var path = el("bottom-center-column").firstChild.getAttribute("path").
      split(",");
    sessionHistoryTree.cloneSubtree(window.parent, path, loadInBG);
  },

  detachSelectedSubtree: function (aInvertBGMode) {
    var loadInBG = prefSvc.getBranch("").getBoolPref(
      "browser.tabs.loadBookmarksInBackground");
    if (aInvertBGMode) loadInBG = !loadInBG;
    var path = el("bottom-center-column").firstChild.getAttribute("path").
      split(",");
    sessionHistoryTree.detachSubtree(window.parent, path, loadInBG);
  },
};

function focusHandler () {
  el("sidebar-keypressrecv").focus();
}

window.addEventListener("SidebarFocused", focusHandler, false);
window.addEventListener("focus", focusHandler, false);
window.addEventListener("click", focusHandler, false);

window.addEventListener(
  "keypress",
  function (evt) {
    if (navigation.popupIsShown || evt.keyCode == 0 
        || evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey) return;
    switch (evt.keyCode) {
      case evt.DOM_VK_UP:
        navigation.selectPrev(1);
        break;

      case evt.DOM_VK_DOWN:
        navigation.selectNext(1);
        break;

      case evt.DOM_VK_LEFT:
        navigation.selectLeft();
        break;

      case evt.DOM_VK_RIGHT:
        navigation.selectRight();
        break;

      case evt.DOM_VK_RETURN:
      case evt.DOM_VK_ENTER:
        navigation.visitSelected();
        break;

      case evt.DOM_VK_DELETE:
        navigation.deleteSelectedSubtree();
        break;

      default:
        return;
    }
    evt.stopPropagation();
  },
  true);
