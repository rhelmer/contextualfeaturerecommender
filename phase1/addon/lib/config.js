/*! This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";
var prefs = require("sdk/preferences/service");
var system = require("sdk/system");
var logger = require("./logger");
var info = require("./generalInfoCollector");
var TEST_MODE;
var USER_ID;

// recommendation counts
exports.CLOSE_TAB_SHORTCUT_COUNT_THRESHOLD = 4;
exports.NEW_TAB_SHORTCUT_COUNT_THRESHOLD = 4;
exports.PRIVATE_WINDOW_PORN_THRESHOLD = 4;
exports.FACEBOOK_COUNT_THRESHOLD = 2;
exports.YOUTUBE_COUNT_THRESHOLD = 4;
exports.DOWNLOAD_COUNT_THRESHOLD = 4;
exports.GMAIL_COUNT_THRESHOLD = 4;
exports.REDDIT_COUNT_THRESHOLD = 2;
exports.AMAZON_COUNT_THRESHOLD = 4;
exports.NEW_BOOKMARK_COUNT_THRESHOLD = 4;
exports.BOOKMARK_SHORTCUT_COUNT_THRESHOLD = 4;
exports.BOOKMARK_MANAGER_COUNT_THRESHOLD = 4;


// standard GA payload info
exports.EXPERIMENT_NAME = "CFR";
exports.EXPERIMENT_VERSION = "0.0";
exports.ADDON_VERSION = "0.1";
exports.TEST_MODE = info.getTestMode(); //set by init()
exports.USER_ID = info.getUserId();

exports.TYPE_OFFERING = "OFFERING";
exports.TYPE_OFFERING_ADDON = "ADDON";
exports.TYPE_INSTALL = "INSTALL";
exports.ID_NA = "NA";

exports.SEND_REQ_TO_GA = "false";