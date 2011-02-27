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

var sessionHistoryTree = {
  sStore: Cc["@mozilla.org/browser/sessionstore;1"].
          getService(Ci.nsISessionStore),

  tabOpenHandler: function (evt) {
    var theTab = evt.target;
    var theBrowser = gBrowser.getBrowserForTab(theTab);

    function range (start, end) {
      for (i = start; i < end; i++) yield i;
    }

    var curSHTStr = this.sStore.getTabValue(theTab, "sessionHistoryTree");
    if (!curSHTStr) {
      let curStateObj = JSON.parse(this.sStore.getTabState(theTab));
      let newSHTObj = {
        tree: curStateObj.entries,
        curPath: [0 for each (i in range(0, curStateObj.index || 0))]
      };
      this.sStore.setTabValue(theTab, "sessionHistoryTree",
                              JSON.stringify(newSHTObj));
    }
  },
};

window.addEventListener(
  "load",
  function __shtWindowLoadListener () {
    gBrowser.tabContainer.addEventListener(
      "TabOpen",
      function (evt) { sessionHistoryTree.tabOpenHandler(evt); },
      false);

    window.removeEventListener("load", __shtWindowLoadListener, false);
  },
  false);
