/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* globals AppConstants, browser, Components, CustomizableUI, dispatcher,
   ExtensionCommon, ExtensionAPI, Services, XPCOMUtils */

"use strict";

ChromeUtils.defineModuleGetter(this, "ExtensionUtils",
                               "resource://gre/modules/ExtensionUtils.jsm");
ChromeUtils.defineModuleGetter(this, "LoginHelper",
                               "resource://gre/modules/LoginHelper.jsm");
ChromeUtils.defineModuleGetter(this, "Services",
                               "resource://gre/modules/Services.jsm");

const { ExtensionError } = ExtensionUtils;

const isValidLogin = (login) => {
  return !(login.hostname || "").startsWith("chrome://");
};

const getLogins = () => {
  const logins = Services.logins.
    getAllLogins().
    filter(isValidLogin).
    map(LoginHelper.loginToVanillaObject);
  return logins;
};

const getLogin = (id) => {
  const login = getLogins().
    filter(l => l.guid === id)[0];
  return login || null;
};

this.logins = class extends ExtensionAPI {
  getAPI(context) {
    const EventManager = ExtensionCommon.EventManager;
    return {
      experiments: {
        logins: {
          // See schema.json for function documentation.
          // The Firefox internal code throws if the wrong type is passed into
          // the LoginManager methods. To reduce the odds of those mistakes,
          // this code follows the following naming convention:
          //   - fooLogin = login as vanilla JS object
          //   - fooLoginInfo = login as nsILoginInfo
          //   - fooBag = (subset of) login fields as nsIPropertyBag
          getAll() {
            const logins = getLogins();
            return logins;
          },
          get(id) {
            const login = getLogin(id);
            return login;
          },
          add(login) {
            if (getLogin(login.guid)) {
              throw new ExtensionError(`Add failed: Login already exists with ID ${login.guid}`);
            }
            try {
              const loginInfo = LoginHelper.vanillaObjectToLogin(login);
              Services.logins.addLogin(loginInfo);
              const addedLogin = getLogin(login.guid);
              return addedLogin;
            } catch (ex) {
              throw new ExtensionError(ex);
            }
          },
          update(newLogin) {
            if (!("guid" in newLogin)) {
              throw new ExtensionError(`Update failed: ID is required`);
            }
            // The addons framework code always supplies null values for missing keys,
            // so filter those out.
            // TODO: Could this cause subtle bugs? Would anyone ever want to update a field to be null? If so, maybe default to 'NULL" (the string), or undefined.
            for (let key in newLogin) {
              if (newLogin[key] === null) {
                delete newLogin[key];
              }
            }
            const oldLogin = getLogin(newLogin.guid);
            if (!oldLogin) {
              throw new ExtensionError(`Update failed: Login not found with ID ${newLogin.guid}`);
            }
            try {
              const updatedLogin = {};
              Object.assign(updatedLogin, oldLogin, newLogin);
              if ("timesUsedIncrement" in newLogin) {
                delete updatedLogin.timesUsed;
              }
              const updatedLoginBag = LoginHelper.newPropertyBag(updatedLogin);
              const oldLoginInfo = LoginHelper.vanillaObjectToLogin(oldLogin);
              Services.logins.modifyLogin(oldLoginInfo, updatedLoginBag);
              const finalLogin = getLogin(newLogin.guid);
              return finalLogin;
            } catch (ex) {
              throw new ExtensionError(ex);
            }
          },
          touch(id) {
            const login = getLogin(id);
            if (!login) {
              throw new ExtensionError(`Touch failed: Login not found with ID ${id}`);
            }
            try {
              const updateBag = LoginHelper.newPropertyBag({
                guid: login.guid,
                timesUsedIncrement: 1,
                timeLastUsed: Date.now(),
              });
              const loginInfo = LoginHelper.vanillaObjectToLogin(login);
              Services.logins.modifyLogin(loginInfo, updateBag);
              const updatedLogin = getLogin(id);
              return updatedLogin;
            } catch (ex) {
              throw new ExtensionError(ex);
            }
          },
          remove(id) {
            const login = getLogin(id);
            if (!login) {
              throw new ExtensionError(`Remove failed: Login not found with ID ${id}`);
            }
            try {
              const loginInfo = LoginHelper.vanillaObjectToLogin(login);
              Services.logins.removeLogin(loginInfo);
            } catch (ex) {
              throw new ExtensionError(ex);
            }
          },
          onAdded: new EventManager(context, "logins.onAdded", fire => {
            const callback = (value) => {
              fire.async(value);
            };
            const observer = {
              observe: (subject, topic, type) => {
                if (type !== "addLogin") {
                  return;
                }
                subject.QueryInterface(Ci.nsILoginMetaInfo).QueryInterface(Ci.nsILoginInfo);
                const login = LoginHelper.loginToVanillaObject(subject);
                if (!isValidLogin(login)) {
                  return;
                }
                callback({ login });
              },
            };
            Services.obs.addObserver(observer, "passwordmgr-storage-changed");
            return () => {
              Services.obs.removeObserver(observer, "passwordmgr-storage-changed");
            };
          }).api(),
          onUpdated: new EventManager(context, "logins.onUpdated", fire => {
            const callback = (value) => {
              fire.async(value);
            };
            const observer = {
              observe: (subject, topic, type) => {
                if (type !== "modifyLogin") {
                  return;
                }
                subject.QueryInterface(Ci.nsIArrayExtensions);
                const newLoginInfo = subject.GetElementAt(1);
                const login = LoginHelper.loginToVanillaObject(newLoginInfo);
                if (!isValidLogin(login)) {
                  return;
                }
                callback({ login });
              },
            };
            Services.obs.addObserver(observer, "passwordmgr-storage-changed");
            return () => {
              Services.obs.removeObserver(observer, "passwordmgr-storage-changed");
            };
          }).api(),
          onRemoved: new EventManager(context, "logins.onRemoved", fire => {
            const callback = (value) => {
              fire.async(value);
            };
            const observer = {
              observe: (subject, topic, type) => {
                if (type !== "removeLogin") {
                  return;
                }
                subject.QueryInterface(Ci.nsILoginMetaInfo).QueryInterface(Ci.nsILoginInfo);
                const login = LoginHelper.loginToVanillaObject(subject);
                if (!isValidLogin(login)) {
                  return;
                }
                callback({ login });
              },
            };
            Services.obs.addObserver(observer, "passwordmgr-storage-changed");
            return () => {
              Services.obs.removeObserver(observer, "passwordmgr-storage-changed");
            };
          }).api(),
          onAllRemoved: new EventManager(context, "logins.onAllRemoved", fire => {
            const callback = (value) => {
              fire.async(value);
            };
            const observer = {
              observe: (subject, topic, type) => {
                if (type !== "removeAllLogins") {
                  return;
                }
                callback();
              },
            };
            Services.obs.addObserver(observer, "passwordmgr-storage-changed");
            return () => {
              Services.obs.removeObserver(observer, "passwordmgr-storage-changed");
            };
          }).api(),
        },
      },
    };
  }
};
