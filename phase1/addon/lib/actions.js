/*! This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";


var {setTimeout} = require("sdk/timers");
var {getBrowserForTab, getTabForId} = require("sdk/tabs/utils");
var tabs = require("sdk/tabs");
var {data} = require("sdk/self");
var logger = require("./logger");
var {URL} = require("sdk/url");
var notifications = require("sdk/notifications");
var featuredata = require("./featuredata");
var config = require("./config");
var windows = require("sdk/windows");
var {sendEvent, sendToGA, override}  = require("./utils");
var ui = require("./ui");

//stores what action each webpage should map to 
var URLToActionMapper = {
	"www.youtube.com": ytDetected, 
	"www.gmail.com": gmailDetected, "mail.google.com": gmailDetected, 
	"www.fifa.com": soccerDetected, 
	"www.goal.com": soccerDetected,
	"www.reddit.com": redditDetected,
	"www.amazon.com": amazonDetected, "www.amazon.ca": amazonDetected,
	"stoppornculture.org": pornDetected,
	"www.facebook.com": facebookDetected,
	"www.google.com": googleDetected, "www.google.ca": googleDetected,  "www.bing.com": bingDetected, "www.bing.ca": bingDetected,
	"en.wikipedia.org": wikipediaDetected, "search.yahoo.com": yahooDetected, "search.yahoo.ca": yahooDetected
};

//stores basic information needed when recommending addons
var addonData = {
	"1click-yt-download": {name: "1-Click YouTube Video Download", link: "https://addons.mozilla.org/firefox/downloads/latest/13990/addon-13990-latest.xpi?src=search"},
	"gmail-notifier": {name: "Gmail Notifier", link: "https://addons.mozilla.org/firefox/downloads/latest/406178/addon-406178-latest.xpi?src=dp-btn-primary"},
	"flashgot": {name: "FlashGot Mass Downloader", link: "https://addons.mozilla.org/firefox/downloads/latest/220/addon-220-latest.xpi?src=search"},
	"googletranslator": {name: "Google™ Translator", link: "https://addons.mozilla.org/firefox/downloads/latest/493406/addon-493406-latest.xpi?src=search"},
	"redditenhancement": {name: "Reddit Enhancement Suite", link: "https://addons.mozilla.org/firefox/downloads/latest/387429/addon-387429-latest.xpi?src=search"},
	"amazonwishlistbutton": {name: "Amazon \"Add to Wish List\" Button", link: "https://addons.mozilla.org/firefox/downloads/latest/257015/addon-257015-latest.xpi?src=dp-btn-primary"},
	"quickmark": {name: "Quick Mark", link: "https://addons.mozilla.org/firefox/downloads/latest/462572/addon-462572-latest.xpi?src=dp-btn-primary"}
}


//shows URI of a tab in a panel
function showNewURI(aBrowser, aWebProgress, aRequest, aLocation){
	console.log("show new URI");
	
	var tab = tabs.activeTab;
	
	if (getBrowserForTab(getTabForId(tab.id)) == aBrowser) {
		
		setTimeout(function (){
  		panel = require("./ui/panel").getPanel();
 		panel.port.emit("message", URL(tab.url).hostname);
 		panel.show();
  			}, 500);
	}
}

// removes all images in a webpage
function loadImageKiller(aBrowser, aWebProgress, aRequest, aLocation){

	var tab = tabs.activeTab;
	
	if (getBrowserForTab(getTabForId(tab.id)) == aBrowser) {
		tab.on("ready", function (){
		tab.attach({
			contentScriptFile: data.url("./ui/imagekiller.js")
		}); } );


	}

}

//TODO
function showOnToolbar(aBrowser, aWebProgress, aRequest, aLocation){
	
	var tab = tabs.activeTab;
	
	if (getBrowserForTab(getTabForId(tab.id)) == aBrowser) {
		
		frame.postMessage(URL(tab.url).hostname, frame.url);
	}	
}

//carries out right action based on (hostname of) current website
function mapActiveURLToAction(aBrowser, aWebProgress, aRequest, aLocation){
	
	var tab = tabs.activeTab;
	logger.log("mapActiveURLToAction");

	// if (tab.id == activeTab.id)
	if (getBrowserForTab(getTabForId(tab.id)) == aBrowser) {
		
		var hostname = URL(tab.url).hostname;
		logger.log(hostname);

		if (hostname in URLToActionMapper) URLToActionMapper[hostname]();
	}	

}

// recommends installing a DL manager to user
function recommendDLManager(download){
	
	var count = featuredata.get("download", "count");
	count++;

	featuredata.set("download", "count", count);

	if (count == config.DOWNLOAD_COUNT_THRESHOLD){

		recommendAddon({addonID: "flashgot"});
	}
}

// recommends a specific addon to user
function recommendAddon(options){
	
	logger.log("recommending addon");

	// setTimeout(function (){
 //  		var panel = require("./ui/panel").getPanel();
 // 		panel.port.emit("updateinnerhtml", "Wanna try downloading " + addonData[options.addonID].name + " ?" + "<br>" + "<a href=\'" + addonData[options.addonID].link + "\'> Click here! </a>");
 // 		panel.port.on("openlinkinnewtab", function(link){
 // 			tabs.activeTab.url = link; //url reverts back again if it's an extension
 // 		});
 // 		panel.show();
 //  			}, 500);

	ui.showNotification({
		message: "Wanna try downloading " + addonData[options.addonID].name + " ?",
		header: "A Cool Addon",
		reactionType: "openlinkinnewtab",
		reactionCallback: function(){
			
			tabs.activeTab.url = addonData[options.addonID].link; //url reverts back again if it's an extension

			},
		buttonLabel: "Install Addon"
		});


	
	var OUTtype = config.TYPE_OFFERING;
	var OUTval = override({offeringType: config.TYPE_OFFERING_ADDON}, options);
	var OUTid = config.ID_NA;  //TODO: determine an id
	
	sendEvent(OUTtype, OUTval, OUTid);

}

function ytDetected(){
	
	logger.log("ytDetect");

	var count = featuredata.get("youtube", "count");
	count++;

	console.log(count);

	featuredata.set("youtube", "count", count);

	if (count == config.YOUTUBE_COUNT_THRESHOLD){
		recommendAddon({addonID: "1click-yt-download"});
	}
}

function gmailDetected(){
	var count = featuredata.get("gmail", "count");
	count++;

	featuredata.set("gmail", "count", count);

	if (count == config.GMAIL_COUNT_THRESHOLD){
		recommendAddon({addonID: "gmail-notifier"});
	}
}

function soccerDetected(){
	
}

function recommendTranslator(){
	var count = featuredata.get("translator", "count");
	count++;

	featuredata.set("translator", "count", count);

	if (count == config.TRANSLATOR_COUNT_THRESHOLD){

		recommendAddon({addonID: "googletranslator"});
	}
}

function redditDetected(){
	var count = featuredata.get("reddit", "count");
	count++;

	featuredata.set("reddit", "count", count);

	if (count == config.REDDIT_COUNT_THRESHOLD){

		recommendAddon({addonID: "redditenhancement"});
	}
}

function amazonDetected(){
	var count = featuredata.get("amazon", "count");
	count++;

	featuredata.set("amazon", "count", count);

	if (count == config.AMAZON_COUNT_THRESHOLD){
		recommendAddon({addonID: "amazonwishlistbutton"});
	}

	extractSearchQuery("amazon");
}

function googleDetected(){

	extractSearchQuery("google");
}

function bingDetected(){
	extractSearchQuery("bing");
}

function yahooDetected(){
	extractSearchQuery("yahoo");
}

function wikipediaDetected(){
	extractSearchQuery("wikipedia");
}

function extractSearchQuery(engine){
	logger.log(URL(tabs.activeTab.url).search);

	var qSeparator;
	var qKeyword;

	var autoSeparator = true; //if set, checks both + and space (ignores qSeparator)


	switch (engine){
		case "google":
			qSeparator = "+";
			qKeyword = "q";
		break;
		case "bing":
			qSeparator = "+";
			qKeyword = "q";
		break;
		case "wikipedia":
			qSeparator = "+";
			qKeyword = "search";

		break;
		case "yahoo":
			qSeparator = "+";
			qKeyword = "p";

		break;
		case "amazon":
			qSeparator = "+";
			qKeyword = "field-keywords";

		break;

	}

	var queryRegExp = new RegExp(".*(?:\\?|\\#|&)" + qKeyword + "=(.*?)(?:\\&|$)", "i");

	var allQs = queryRegExp.exec(URL(tabs.activeTab.url).search + URL(tabs.activeTab.url).hash);

	if (allQs){
		logger.log("matched a " + engine + " search query: " + allQs[1]);
		
		if (autoSeparator){
			var queries = allQs[1].split(/\W(?:\d|\W)*/i);
			// if (allQs[1].search(/ /i) != -1)
			// 	qSeparator = " ";
			// else
			// 	qSeparator = "+";
		} 
		else 
			var queries = allQs[1].split(qSeparator);

		queries.map(function (elm){
			logger.log(elm);
		});
	}
}

function recommendPinTab(){

	ui.showNotification({
		message: "It seems that you frequently visit this page. You might want to pin its tab!",
		header: "App Page",
		reactionType: "openlinkinnewtab",
		reactionCallback: function(){
			// tabs.activeTab.pin(); 
			tabs.open("https://support.mozilla.org/en-US/kb/pinned-tabs-keep-favorite-websites-open");

			},
		buttonLabel: "Show Me How"
		});

}

function facebookDetected(){

	var count = featuredata.get("facebook", "count");
	count++;

	featuredata.set("facebook", "count", count);

	if (count == config.FACEBOOK_COUNT_THRESHOLD){

		recommendPinTab();
	}	
}



function pornDetected(){
	
	logger.log("pornDetected"); 

	var count = featuredata.get("privatewindowporn", "count");
	count++;

	featuredata.set("privatewindowporn", "count", count);

	if (count == config.PRIVATE_WINDOW_PORN_COUNT_THRESHOLD){

		ui.showNotification({
		message: "You might want to open view this page in a private window.",
		header: "Private Page",
		reactionType: "openlinkinnewtab",
		reactionCallback: function(){

			// open in a private window
	 		/*	windows.browserWindows.open({
	 				url: tabs.activeTab.url,
	 				isPrivate: true
	 			});
	 			tabs.activeTab.close(); */

			tabs.open("https://support.mozilla.org/en-US/kb/private-browsing-browse-web-without-saving-info");

			},
		buttonLabel: "Show Me How"
		});

	}
}

function recommendKeyboardShortcut(){
	//TODO
}

//recommends using a keyboard shortcut to open a  new tab
function recommendNewTabShortcut(event){
	logger.log("recommendNewTabShortcut");

	var count = featuredata.get("newtabshortcut", "count");
	count++;

	featuredata.set("newtabshortcut", "count", count);

	if (count == config.NEW_TAB_SHORTCUT_COUNT_THRESHOLD){

		ui.showNotification({
		message: "You can also use CTRL+T to open a new tab! Why don't you give it a try?",
		header: "New Tab",
		reactionType: "noreaction",
		reactionCallback: function(){

			},
		buttonLabel: "Got It"
		});

	}
	

}

function recommendCloseTabShortcut(event){
	logger.log("recommendCloseTabShortcut");

	var count = featuredata.get("closetabshortcut", "count");
	count++;

	featuredata.set("closetabshortcut", "count", count);

	if (count == config.CLOSE_TAB_SHORTCUT_COUNT_THRESHOLD){

		ui.showNotification({
		message: "You can also use CTRL+W to close a tab!",
		header: "Close Tab",
		reactionType: "noreaction",
		reactionCallback: function(){

			},
		buttonLabel: "Got It"
		});

	}
}

function recommendBookmarkManager(){
	var count = featuredata.get("newbookmark", "count");
	count++;

	featuredata.set("newbookmark", "count", count);

	if (count == config.BOOKMARK_MANAGER_COUNT_THRESHOLD){
		recommendAddon({addonID: "quickmark"});
	}
}

function recommendNewBookmarkShortcut(event){
	var count = featuredata.get("newbookmark", "count");
	count++;

	featuredata.set("newbookmark", "count", count);

	if (count == config.BOOKMARK_SHORTCUT_COUNT_THRESHOLD){

		ui.showNotification({
		message: "You can also use CTRL+D to to bookmark a page! Why don't you give it a try?",
		header: "New Bookmark",
		reactionType: "noreaction",
		reactionCallback: function(){

			},
		buttonLabel: "Got It"
		});
	}	

}

exports.showNewURI = showNewURI;
exports.loadImageKiller = loadImageKiller;
exports.showOnToolbar = showOnToolbar;
exports.mapActiveURLToAction = mapActiveURLToAction;
exports.recommendDLManager = recommendDLManager;
exports.recommendNewTabShortcut = recommendNewTabShortcut;
exports.recommendTranslator = recommendTranslator;
exports.recommendNewBookmarkShortcut = recommendNewBookmarkShortcut;
exports.recommendBookmarkManager = recommendBookmarkManager;
exports.recommendCloseTabShortcut = recommendCloseTabShortcut;