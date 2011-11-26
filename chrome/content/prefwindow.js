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

const Cu = Components.utils, Cc = Components.classes,
      Ci = Components.interfaces;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://sessionhistorytree/sessionHistoryTree.jsm");

XPCOMUtils.defineLazyServiceGetter(
  this, "prefSvc", "@mozilla.org/preferences-service;1", "nsIPrefService");
XPCOMUtils.defineLazyGetter(
  this, "prefs",
  function () prefSvc.getBranch("extensions.sessionhistorytree."));
XPCOMUtils.defineLazyGetter(
  this, "browserPrefs",
  function () prefSvc.getBranch("browser.preferences."));

function el (aId) document.getElementById(aId)

window.addEventListener(
  "load",
  function () { el("entershortcut_lbl").style.visibility = "hidden"; },
  false);

var setupKeycodeTable = [
    0, "",
    3, "CANCEL",
    6, "HELP",
    8, "BACK_SPACE",
    9, "TAB",
   12, "CLEAR", "RETURN", "ENTER",
   16, "SHIFT", "CONTROL", "ALT", "PAUSE", "CAPS_LOCK",
   27, "ESCAPE",
   32, "SPACE", "PAGE_UP", "PAGE_DOWN", "END", "HOME", "LEFT", "UP", "RIGHT",
       "DOWN", "SELECT", "PRINT", "EXECUTE", "PRINTSCREEN", "INSERT", "DELETE",
   93, "CONTEXT_MENU",
   96, "NUMPAD0", "NUMPAD1", "NUMPAD2", "NUMPAD3", "NUMPAD4", "NUMPAD5",
       "NUMPAD6", "NUMPAD7", "NUMPAD8", "NUMPAD9", "MULTIPLY", "ADD",
       "SEPARATOR", "SUBTRACT", "DECIMAL", "DIVIDE",
       "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11",
       "F12", "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21",
       "F22", "F23", "F24",
  144, "NUM_LOCK", "SCROLL_LOCK",
];

var keycodesToSymbols = {}, symbolsToKeycodes = {};
{
  let i = 0, keycode = 0;
  while (i < setupKeycodeTable.length) {
    let elem = setupKeycodeTable[i];
    let elemNum = parseInt(elem);
    if (!isNaN(elemNum)) {
      i++;
      keycode = elemNum;
      continue;
    }
    keycodesToSymbols[keycode] = elem;
    symbolsToKeycodes[elem] = keycode;
    i++;
    keycode++;
  }
}
delete setupKeycodeTable;

function synctopref () {
  var value = el("sidebar-shortcut-key").value;
  prefs.setIntPref("sidebarkeycode",
                   value in symbolsToKeycodes ? symbolsToKeycodes[value] : 0);
  return value;
}

function captureshortcut (evt) {
  el("entershortcut_lbl").style.visibility = "visible";
  var btn = el("sidebar-shortcut-keypressrecv");
  btn.addEventListener("keypress", keycapture, false);
  btn.focus();
}

function keycapture (evt) {
  var modifiers = [];
  [["ctrlKey", "control"], ["altKey", "alt"],
   ["metaKey", "meta"], ["shiftKey", "shift"]].forEach(
    function (m, idx, ary) {
      if (evt[m[0]]) modifiers.push(m[1]);
    });
  modifiers = modifiers.join(",");

  if (evt.charCode == 0 || evt.location == 3 /* keypad */)
    var char = keycodesToSymbols[evt.keyCode];
  else
    var char = String.fromCharCode(evt.charCode);
  var modTxt = el("sidebar-shortcut-modifiers"),
      keyTxt = el("sidebar-shortcut-key");
  modTxt.value = modifiers;
  var inpEvt = document.createEvent("Event");
  inpEvt.initEvent("input", true, true);
  modTxt.dispatchEvent(inpEvt);
  keyTxt.value = char;
  inpEvt = document.createEvent("Event");
  inpEvt.initEvent("input", true, true);
  keyTxt.dispatchEvent(inpEvt);

  evt.stopPropagation();
  el("entershortcut_lbl").style.visibility = "hidden";
  el("sidebar-shortcut-keypressrecv").
    removeEventListener("keypress", keycapture, false);
  el("sidebar-shortcut-capturebtn").focus();
}
