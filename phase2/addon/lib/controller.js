

"use strict";

const {getMostRecentBrowserWindow, isBrowser} = require("sdk/window/utils");
const {WindowTracker} = require("sdk/deprecated/window-utils");
const {Route} = require("./route");
const {URL} = require("sdk/url");
const {getBrowserForTab, getTabForId} = require("sdk/tabs/utils");
const tabs = require("sdk/tabs");
const {Event, eventData, eventDataAddress} = require("./event");
const {Cu, Cc, Ci} = require("chrome");
const {prefs} = require("sdk/simple-prefs");
const presenter = require("./presenter");
const { MatchPattern } = require("sdk/util/match-pattern");
const {PersistentRecSet} = require("./recommendation");
const timer = require("./timer");
const {delMode} = require("./self");
const system = require("sdk/system");
const windows = require("sdk/windows");
const {modelFor} = require("sdk/model/core");
const {viewFor} = require("sdk/view/core");
const tab_utils = require("sdk/tabs/utils");
const {handleCmd} = require("./debug");
Cu.import("resource://gre/modules/Downloads.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
const devtools = Cu.import("resource://gre/modules/devtools/Loader.jsm", {}).devtools;

const observerService = Cc["@mozilla.org/observer-service;1"]
                      .getService(Ci.nsIObserverService);

const NEWTAB_URL = 'about:newtab';
const HOME_URL = 'about:home';
const BLANK_URL = 'about:blank';

const recSetAddress = "controller.recommData";

let recommendations = PersistentRecSet("simplePref", {address: recSetAddress});

let downloadList;
let hs;
let sessObserver;
let contentTypeObserver;
let searchEngineObserver;

const init = function(){
  console.log("initializing controller");
  listener.start();
  deliverer.init();
  debug.init();
}

/**
 * Listens for events exhibited by the user.
 *
 */
const listener = {
  start: function(){

    console.log("starting listener");

    let that = this;

    this.listenForTabs(function(reason, params){
      let tabsEvent = Event("tabsEvent", {
        route: ["tabs", reason].join(" "),
        reason: reason,
        params: params
      });

      tabsEvent.effect = function(){
        let route = this.options.route;

        //pinned is not about tabs being pinned
        //it is about reporting the number of pinned tabs
        //so should not be dispatched as tabs even
        if (this.options.reason == "pinned") return;
        
        listener.dispatchRoute(route);
      };

      let multipleTabsEvent = that.multipleRoute(tabsEvent);

      //see above
      multipleTabsEvent.checkPreconditions = function(){
        return (this.preEvent.options.reason != "pinned");
      };

      tabsEvent.postEvents.push(multipleTabsEvent);

      let tabsOpened = Event("tabsOpened");

      tabsOpened.effect = function(){
        let baseRoute = this.preEvent.options.route;

        let route = [baseRoute, "-n", this.preEvent.options.params.number].join(" ");

        listener.dispatchRoute(route);
      };

      tabsOpened.checkPreconditions = function(){
        return (this.preEvent.options.reason == "opened");
      };

      tabsEvent.postEvents.push(tabsOpened);

      let tabsPinned = Event("tabsPinned");

      tabsPinned.effect = function(){
        let baseRoute = this.preEvent.options.route;

        let route = [baseRoute, "-n", this.preEvent.options.params.number].join(" ");

        listener.dispatchRoute(route);
      };

      tabsPinned.checkPreconditions = function(){
        return (this.preEvent.options.reason == "pinned");
      };

      tabsEvent.postEvents.push(tabsPinned)

      let tabsClicked = Event("tabsClicked");

      tabsClicked.effect = function(){
        let baseRoute = this.preEvent.options.route;

        let route = [baseRoute, "-position", this.preEvent.options.params.position].join(" ");

        this.options.route = route;

        // listener.dispatchRoute(route);
      };

      tabsEvent.postEvents.push(tabsClicked);

      tabsClicked.checkPreconditions = function(){
        return (this.preEvent.options.reason == "clicked");
      };

      let multipleTabsClicked = that.multipleRoute(tabsClicked);

      tabsClicked.postEvents.push(multipleTabsClicked);

      tabsEvent.wake();


    });

    this.listenForAddonEvents(function(eventType, params){
      let addonEvent = Event("addonEvent", {
        eventType: eventType,
        params: params
      });

      addonEvent.effect = function(){
        let route;
        switch(this.options.eventType){
          case "count":
          route = ["addon", this.options.eventType, "-" + this.options.params.type, "-n", this.options.params.number].join(" ");
          break;
          case "pageshow":
          route = ["addon", this.options.eventType].join(" ");
          break;
          default:
          route = ["addon", this.options.eventType, params.addonId].join(" ");
        }
        this.options.route = route;
        listener.dispatchRoute(route);
      };

      addonEvent.wake();
    });

    // this.listenForContentType(function(contentType){
    //   let contentTypeEvent = Event("contentTypeEvent",
    //   {
    //     route: ["contentType", contentType].join(" "),
    //     contentType: contentType
    //   });

    //   contentType.effect = function(){
    //     let route = this.options.route;

    //     listener.dispatchRoute(route);
    //   };

    //   let multipleContentType = that.multipleRoute(contentTypeEvent);

    //   contentTypeEvent.postEvents.push(multipleContentType);

    //   contentTypeEvent.wake();

    // }, ["application/json", "application/epub+zip"]);

    this.listenForActiveNewtab(function(){
      let newtabEvent = Event("newtabEvent", {
        route: 'newtab'
       });

      newtabEvent.effect = function(){
        listener.dispatchRoute(this.options.route);
      };

      let interruptibeMomentEvent = Event("interruptibeMomentEvent", 
      {
        route: "*"
      });

      interruptibeMomentEvent.checkPreconditions = function(){
        // return (delMode.moment === 'interruptible') ;
        return (timer.isRecentlyActive());
        
      }

      interruptibeMomentEvent.effect = function(){
        listener.context(this.options.route);
      }

      newtabEvent.postEvents.push(interruptibeMomentEvent);

      newtabEvent.wake();
    });

    //TODO: merge with chromeEvent
    this.listenForKeyboardEvent(function(evt){

      let hotkeyEvent = Event("hotkeyEvent", {
        event: evt
      });

      hotkeyEvent.effect = function(){
        let e = this.options.event;
        let route = ["hotkey", e.key,
                   e.metaKey ? "-meta" : "",
                   e.ctrlKey ? "-ctrl" : "",
                   e.shiftKey ? "-shift" : "",
                   e.altKey ? "-alt" : "" ].filter(function(elm){
                    return elm != "";
                   }).join(" ");

        listener.dispatchRoute(route);

        let osDarwin = system.platform === 'darwin'; //TODO

        route = ["hotkey", e.key,
                ((e.metaKey && osDarwin) || (e.ctrlKey && !osDarwin)) ? "-cmd" : "",
                e.shiftKey ? "-shift" : "",
                e.altKey ? "-alt" : ""].filter(function(elm){
                    return elm != "";
                   }).join(" ");

        //TODO: solve thE multiple correct routes problem by adding the capability of having multople
        //routes for behaviors and contexts (or adding route equivalence test)

        listener.dispatchRoute(route);

        this.options.route = route; //TOTHINK: the first route is ignored for postEvents
      }

      hotkeyEvent.checkPreconditions = function(){
        let e = this.options.event;
        return (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey);
      }

      let multipleHotkeyEvent = that.multipleRoute(hotkeyEvent);

      hotkeyEvent.postEvents.push(multipleHotkeyEvent);

      hotkeyEvent.wake();

    });

    this.listenForChromeEvents(function(evtName, evt){

      let chromeEvent = Event("chromeEvent", {
        route: ["chrome", evtName, evt.currentTarget.getAttribute("id")].join(" "),
        event: evt,
        eventName: evtName
      });

      chromeEvent.effect = function(){
        let route = this.options.route;

        listener.dispatchRoute(route);
      }

      let multipleChromeEvent = that.multipleRoute(chromeEvent);
      chromeEvent.postEvents.push(multipleChromeEvent);

      let chromeEventAnon = Event("chromeEventAnon");

      chromeEventAnon.effect = function(){
        let anonid = this.preEvent.options.event.originalTarget.getAttribute("anonid");
        let baseRoute = this.preEvent.options.route;
        this.options.route = [baseRoute, "-anonid", anonid].join(" ");

        let route = this.options.route;

        listener.dispatchRoute(route);
      }

      chromeEventAnon.checkPreconditions = function(){
        return (!!this.preEvent.options.event.originalTarget.getAttribute("anonid"));
      }

      let multipleChromeEventAnon = that.multipleRoute(chromeEventAnon);

      chromeEventAnon.postEvents.push(multipleChromeEventAnon);

      chromeEvent.postEvents.push(chromeEventAnon);

      chromeEvent.wake();

    });

    //TODO: combine webapp, category, and hostname progress into url progress

    this.listenForWebApps(function(appId){

      let webAppOpen = Event("webAppOpen",{
        route: "visit webapp",
        appId: appId
      });

      webAppOpen.effect = function(){
        let route = this.options.route;

        listener.dispatchRoute(route);
      }

      let multipleWebAppOpen = that.multipleRoute(webAppOpen);

      webAppOpen.postEvents.push(multipleWebAppOpen);

      let webAppOpenId = Event("webAppOpenId");

      webAppOpenId.effect = function(){
        let baseRoute = this.preEvent.options.route;
        let appId = this.preEvent.options.appId;

        let route = [baseRoute, "-appId", appId].join(" ");
        this.options.route = route;

        listener.dispatchRoute(route);
      }

      let multipleWebAppOpenId = that.multipleRoute(webAppOpenId);

      webAppOpenId.postEvents.push(multipleWebAppOpenId);

      webAppOpen.postEvents.push(webAppOpenId);

      webAppOpen.wake();
      
    }, {fresh: true});

    this.listenForWebsiteCategories(function(category){
      let websiteCategoryEvent = Event("websiteCategoryEvent", {
        route: ["visit category", category].join(" "),
        category: category
      });

      websiteCategoryEvent.effect = function(){
        let route = this.options.route;

        listener.dispatchRoute(route);
      }

      let multipleWebsiteCategoryEvent = that.multipleRoute(websiteCategoryEvent);
      websiteCategoryEvent.postEvents.push(multipleWebsiteCategoryEvent);

      websiteCategoryEvent.wake();

    }, {fresh: false});

    this.listenForActiveTabHostnameProgress(function(hostname){

      let hostVisit = Event("activeTabHostnameVisit", {
        hostname: hostname,
        route: ["visit", "hostname", hostname].join(" ")
      });

      hostVisit.effect = function(){
        let hostname = this.options.hostname; //TODO: remove if unnecessary
        let route = this.options.route;

        listener.dispatchRoute(route);
        };

        let multipleHostVisit = that.multipleRoute(hostVisit);

        hostVisit.postEvents.push(multipleHostVisit);
        hostVisit.wake();

    }, {fresh: true});

    this.listenForSearchEngine(function(reason, params){

      let searchEngModify = Event("searchEngModify",
      {
        route: ["search-engine", reason].join(" "),
        reason: reason,
        params: params
      });

      searchEngModify.effect = function(){
        let route = this.options.route;
        let reason = this.options.reason;

        if (reason != "alias")
          listener.dispatchRoute(route);
      };


      let multipleSearchEngModify = that.multipleRoute(searchEngModify);
      searchEngModify.postEvents.push(multipleSearchEngModify);

      let searchEngAliasEvent = Event("searchEngModifyAliasEvent");

      searchEngAliasEvent.effect = function(){
        let baseRoute = this.preEvent.options.route;
        let params = this.preEvent.options.params;

        let route = [baseRoute, "-n", params.number].join(" ");

        listener.dispatchRoute(route);
      };

      searchEngAliasEvent.checkPreconditions = function(){
        return (this.preEvent.options.reason == "alias");
      }

      searchEngModify.postEvents.push(searchEngAliasEvent);

      searchEngModify.wake();

    });

    this.listenForDevTools(function(reason, params){
      let devToolsEvent = Event("devToolsEvent", {
        route: ["dev", reason].join(" "),
        reason: reason,
        params: params
      });

      devToolsEvent.effect = function(){
        let route = this.options.route;

        listener.dispatchRoute(route);
      };

      let multipleDevToolsEvent = that.multipleRoute(devToolsEvent);

      devToolsEvent.postEvents.push(multipleDevToolsEvent);

      let devToolsSelect = Event("devToolsSelect");

      devToolsSelect.effect = function(){
        let baseRoute = this.preEvent.options.route;
        let toolId = this.preEvent.options.params.toolId;

        let route = [baseRoute, "-tool", toolId].join(" ");

        this.options.route = route;
        this.options.toolId = toolId;

        listener.dispatchRoute(route);
      }

      devToolsSelect.checkPreconditions = function(){
        return (this.preEvent.options.reason == "select");
      };

      devToolsEvent.postEvents.push(devToolsSelect);

      let multipleDevToolsSelect = that.multipleRoute(devToolsSelect);
      devToolsSelect.postEvents.push(multipleDevToolsSelect);

      devToolsEvent.wake();

    });

    this.listenForSessionStore(function(reason){
      let sessRestored = Event("sessionRestored", {
        reason: reason,
        route: ["session", reason].join(" ")
      });

      sessRestored.effect = function(){
        let route = this.options.route;
        listener.dispatchRoute(route);
      }

      sessRestored.checkPreconditions = function(){
        return (this.options.reason == "restored");
      };

      let multipleSessRestored = that.multipleRoute(sessRestored);
      sessRestored.postEvents.push(multipleSessRestored);

      sessRestored.wake();
    });

    this.listenForPrivateBrowsing(function(reason){
      let privateBrowse = Event("privateBrowse", {
        reason: reason,
        route: ["private browse", reason].join(" ")
      });

      privateBrowse.effect = function(){
        let route = this.options.route;
        listener.dispatchRoute(route);
      }

      let multiplePrivateBrowse = that.multipleRoute(privateBrowse);

      privateBrowse.postEvents.push(multiplePrivateBrowse);
      privateBrowse.wake();
    });

  
    this.listenForHistory(function(reason){
      let histInteraction = Event(("historyInteraction"), {
        reason: reason,
        route: "history"
      });

      histInteraction.effect = function(){
        let route = this.options.route;

        listener.dispatchRoute(route);
      };

      let multipleHistInteraction = that.multipleRoute(histInteraction);
      histInteraction.postEvents.push(multipleHistInteraction);

      //delete or clear
      //TODO: implement as separate and merge using OR operation
      
      let histDeleted = Event("historyDeleted");

      histDeleted.effect = function(){
        let reason = this.preEvent.options.reason;
        let baseRoute = this.preEvent.options.route;
        this.options.route = [baseRoute, "deleted"].join(" ");

        let route = this.options.route;

        listener.dispatchRoute(route);
      }

      histDeleted.checkPreconditions = function(){
        return (["cleared", "deletedURI", "deletedvisits"].indexOf(this.preEvent.options.reason) != -1);
      }

      histInteraction.postEvents.push(histDeleted);

      let multipleHistDeleted = that.multipleRoute(histDeleted);
      histDeleted.postEvents.push(multipleHistDeleted);

      histInteraction.wake();
    });

    this.listenForDownloads(function(reason){

      let downloadInteraction = Event("downloadInteraction", {
        reason: reason,
        route: "download"
      });

      downloadInteraction.effect = function(){
        let route = this.options.route;

        listener.dispatchRoute(route);
      };

      let multipleDownloadInteraction = that.multipleRoute(downloadInteraction);
      downloadInteraction.postEvents.push(multipleDownloadInteraction);

      //Download Added
      let downloadAdded = Event("downloadAdded");

      downloadAdded.effect = function(){
        let reason = this.preEvent.options.reason;
        let baseRoute = this.preEvent.options.route;
        this.options.route = [baseRoute, reason].join(" ");

        let route = this.options.route;

        listener.dispatchRoute(route);
      };

      downloadAdded.checkPreconditions = function(){
        return this.preEvent.options.reason === "added";
      };

      let multipleDownloadAdded = that.multipleRoute(downloadAdded);
      downloadAdded.postEvents.push(multipleDownloadAdded);

     
      //Download Changed
      let downloadChanged = Event("downloadChanged");

      downloadChanged.effect = function(){
        let reason = this.preEvent.options.reason;
        let baseRoute = this.preEvent.options.route;
        this.options.route = [baseRoute, reason].join(" ");

        let route = this.options.route;

        listener.dispatchRoute(route);
      };

      downloadChanged.checkPreconditions = function(){
        return this.preEvent.options.reason === "changed";
      };

      let multipleDownloadChanged = that.multipleRoute(downloadChanged);
      downloadChanged.postEvents.push(multipleDownloadChanged);

      //Download Removed
      let downloadRemoved = Event("downloadRemoved");

      downloadRemoved.effect = function(){
        let reason = this.preEvent.options.reason;
        let baseRoute = this.preEvent.options.route;
        this.options.route = [baseRoute, reason].join(" ");

        let route = this.options.route;

        listener.dispatchRoute(route);
      };

      downloadRemoved.checkPreconditions = function(){
        return this.preEvent.options.reason === "removed";
      };

      let multipleDownloadRemoved = that.multipleRoute(downloadRemoved);
      downloadRemoved.postEvents.push(multipleDownloadRemoved);


      downloadInteraction.postEvents.push(downloadAdded, downloadChanged, downloadRemoved);
      downloadInteraction.wake();

    });
  },
  behavior: undefined, //defined below
  context: undefined, //defined below
  listenForActiveTabHostnameProgress: undefined, //defined below
  listenForDownloads: undefined, //defined blow
  multipleRoute: undefined //defined below
};


const deliverer = {
  init: function(){
    timer.tickCallback(this.checkSchedule);
  },
  deliver: function (/* recommendations */) {

    let recomms = Array.prototype.slice.call(arguments);

    if (recomms.length === 0)
      return;

    if (recomms.length > 1)
      console.log("warning: attempted to deliver multple recommendations at the same time.");

    //finding the recommendation with the highest priority

    let minPriority = recomms[0];
    let minRec = recomms[0];

    recomms.forEach(function(aRecommendation){
      if (aRecommendation.priority < minPriority){
        minPriority = aRecommendation.priority;
        minRec = aRecommendation;
      }
    });

    let aRecommendation = minRec;

    if (delMode.rateLimit){
      if (timer.isSilent()){
        console.log("delivery rejected due to silence: id -> " + aRecommendation.id);

        if (delMode.moment === "random"){
          console.log("rescheduling delivery time: id -> " + aRecommendation.id);
          this.rescheduleDelivery(aRecommendation);
          recommendations.update(aRecommendation);
        }
        return;
      }
    }

    console.log("delivering " + aRecommendation.id);
    presenter.present(aRecommendation, listener.command.bind(listener));

    aRecommendation.status = "delivered";
    recommendations.update(aRecommendation);

    timer.silence();

  },
  checkSchedule: function(time){
    let recomms = recommendations.getByRouteIndex('delivContext', '*', 'outstanding');

    if (recomms.length === 0)
      return;
    
    deliverer.deliver.apply(deliverer, recomms.filter(function(aRecommendation){ 
      return aRecommendation.deliveryTime && (aRecommendation.deliveryTime <= time);
    }));
  },
  scheduleDelivery: function(aRecommendation){
    let time = timer.elapsedTime();
    let deliveryTime = timer.randomTime(time, time + prefs["random_interval_length_tick"]);
    aRecommendation.deliveryTime = deliveryTime;

    console.log("recommendation delivery scheduled: id -> " + aRecommendation.id + ", time -> " + deliveryTime + " ticks");
  },
  rescheduleDelivery: function(aRecommendation){
    this.scheduleDelivery(aRecommendation);
    
    console.log("recommendation delivery rescheduled: id -> " + aRecommendation.id + ", time -> " + aRecommendation.deliveryTime + " ticks");
  }
};


listener.behavior = function(route){
  console.log("behavior -> route: " + route);

  //TODO: use pattern matching 
  // https://developer.mozilla.org/en-US/Add-ons/SDK/Low-Level_APIs/util_match-pattern
  
  let recomms = recommendations.getByRouteIndex('trigBehavior', route, 'active');
  if (recomms.length === 0)
    return;

  let random = (delMode.moment === "random");

  recomms.forEach(function(aRecommendation){
    aRecommendation.status = 'outstanding';

    if (random){
      deliverer.scheduleDelivery(aRecommendation);
    }

    recommendations.update(aRecommendation);
  });

};

listener.context = function(route){

  if ((delMode.moment === 'interruptible' && route != '*') || delMode.moment === 'random')
    return;

  console.log("context -> route: " + route);
 
  let recomms = recommendations.getByRouteIndex('delivContext', route, 'outstanding');
  //TODO: use pattern matching 
  // https://developer.mozilla.org/en-US/Add-ons/SDK/Low-Level_APIs/util_match-pattern
  if (recomms.length === 0)
    return;

  //deliver recommendation
  deliverer.deliver.apply(deliverer, recomms);
};

listener.featureUse = function(route){
  console.log("featureUse -> route: " + route);

  let recomms = recommendations.getByRouteIndex('featUseBehavior', route);

  if (recomms.length === 0)
    return;

  recomms.forEach(function(aRecommendation){
    if (aRecommendation.status === 'active' || aRecommendation.status === 'outstanding'){
      aRecommendation.status = 'inactive';
      recommendations.update(aRecommendation);
    }
  });
}

listener.command = function(cmd){
  let cmdRoute = Route(cmd);

  switch(cmdRoute.header){
    case "open url":
      if (cmdRoute.l) 
        tabs.open(cmdRoute.l);
      else
        console.log("no url provided for command: " + cmd);
      break;
    default:
      console.log("command not recognized: " + cmd);
  }

}

listener.dispatchRoute = function(route, options){
  if (!options){
    this.behavior(route);
    this.context(route);
    this.featureUse(route);
  }
  else {
    if (options.behavior)
      this.behavior(route);

    if (options.context)
      this.context(route);

    if (optiona.featureUse)
      this.featureUse(route);
  }
}

listener.listenForAddonEvents = function(callback){

  tabs.on('ready', function(tab){
    if (tab.url == "about:addons")
      callback('pageshow');
  });

  function reportCount(){
    AddonManager.getAllAddons(function(addons){
        callback('count', {number: addons.length, type: 'all'});
      });
      AddonManager.getAddonsByTypes(['extension'], function(addons){
        callback('count', {number: addons.length, type: 'extension'});
      });
      AddonManager.getAddonsByTypes(['theme'], function(addons){
        callback('count', {number: addons.length, type: 'theme'});
      });
  }

  let addonListener = {
    onInstallEnded: function(install, addon){
      callback('install', {addonId: addon.id});
      callback('has', {addonId: addon.id});
      reportCount();
    }
  }

  AddonManager.addInstallListener(addonListener);

  AddonManager.getAllAddons(function(addons){
    reportCount();
    addons.forEach(function(addon){
      callback('has', {addonId: addon.id});
    });
  });
}

listener.listenForActiveNewtab = function(callback){
  tabs.on('open', function(tab){
    if ([NEWTAB_URL, HOME_URL].indexOf(tab.url) != -1) callback();
  });
}

listener.listenForActiveTabHostnameProgress = function(callback, options){

  tabs.on("ready", function(tab){
      if (tab.id !== tabs.activeTab.id) return;//make sure it's the active tab
        
        let hostname = URL(tab.url).hostname;

        //TOTHINK: potential namespace conflict      
        if (options.fresh && hostname === tab.hostname) return; //not a fresh url open

        tab.hostname = hostname;

        //TODO: use pattern matching 
        // https://developer.mozilla.org/en-US/Add-ons/SDK/Low-Level_APIs/util_match-pattern
        if (!hostname) return;//to handle new tabs and blank pages


        console.log("active tab progressed to: " + hostname);

        callback(hostname);

  });
};


//TODO: make this a more general listener (can be combined with listener for MIME types)
listener.listenForWebApps = function(callback, options){

  let apps = {};

  apps = {
    googleCal: new MatchPattern(/https:\/\/www\.google\.com\/calendar\/.*/),
    gmail: new MatchPattern(/https:\/\/mail\.google\.com\/.*/),
    gdrive: new MatchPattern(/https:\/\/drive\.google\.com\/.*/),
    twitter: new MatchPattern(/https:\/\/twitter\.com.*/)
  }

  tabs.on("ready", function(tab){
    // if (tab.id !== tabs.activeTab.id) return;//make sure it's the active tab
      
    let appId = null;

    for (let id in apps){
      if (apps[id].test(tab.url))
        appId = id;
    }

    //TOTHINK: potential namespace conflict      
    if (options.fresh && appId === tab.appId) return; //not a fresh url open

    tab.appId = appId;

    //TODO: use pattern matching 
    // https://developer.mozilla.org/en-US/Add-ons/SDK/Low-Level_APIs/util_match-pattern
    if (!appId) return; //app not recognized

    callback(appId);
  });
};

listener.listenForWebsiteCategories = function(callback, options){

  let catIndx = {};

  catIndx = {
    academic: [ new MatchPattern(/http:\/\/ieeexplore\.ieee\.org\/.*/),
                new MatchPattern(/https:\/\/scholar\.google\..*/),
                new MatchPattern(/http:\/\/www\.sciencedirect\.com\/.*/),
                new MatchPattern(/http:\/\/dl\.acm\.org\/.*/)
                ],
    search:   [ new MatchPattern(/https:\/\/www\.google\.com\/\?.*/),
                new MatchPattern(/https:\/\/www\.bing\.com\/search\?.*/),
                new MatchPattern(/https:\/\/.*\.search\.yahoo\.com\/.*/)
                ],
    specializedSearch: [ new MatchPattern(/http:\/\/www\.google\.com\/maps\/search\/.*/),
                         new MatchPattern(/http:\/\/www\.imdb\.com\/find\?.*/),
                         new MatchPattern(/https:\/\/en\.wikipedia\.org\/wiki\/Special:Search\?.*/),
                         new MatchPattern(/https:\/\/en\.wikipedia\.org\/w\/index\.php\?search.*/)
                         ]
  };

  tabs.on("ready", function(tab){
    // if (tab.id !== tabs.activeTab.id) return;

    let cats = [];

    for (let c in catIndx){
      let arr = catIndx[c];

      for (let i in arr){
        let pattern = arr[i];
        if (pattern.test(tab.url)){
          cats.push(c);
          break;
        }
      }
    }

    //TOTHINK: potential namespace conflict    
    if (options.fresh && JSON.stringify(cats) === JSON.stringify(tab.cats)) return;

    tab.cats = cats;

    if (cats.length == 0) return;

    cats.forEach(function(cat){
      callback(cat);
    });
  });

}

listener.listenForTabs = function(callback, options){
  let reason;

  let countPinnedTabs = function(){
    let c = 0;

    for (let i in tabs)
      if (tabs[i].isPinned)
        c++;

    return c
  }

  let windowTracker = new WindowTracker({
    onTrack: function (window){

      if (!isBrowser(window)) return;

      let tabBrowser = window.gBrowser;
      tabBrowser.tabContainer.addEventListener("TabPinned", function(e){
        reason = "pinned";
        callback(reason, {number: countPinnedTabs()});
      });
      tabBrowser.tabContainer.addEventListener("TabUnpinned", function(e){
        reason = "pinned";
        callback(reason, {number: countPinnedTabs()});
      });
    }
  });


  let tabClick = function(e){
      reason = "clicked";

      if (e.currentTarget.getAttribute("last-tab") === "true"){
        callback(reason, {position: "last"});
      };

      if (e.currentTarget.getAttribute("first-tab") === "true"){
        callback(reason, {position: "first"});
      };

      // if (e.currentTarget.tabIndex < 8)
      //   callback(reason, {position: "1-8"});
    };

  tabs.on('open', function(tab){
    reason = "opened";
    callback(reason, {number: tabs.length});

    //listen for clicks
    let xulTab = viewFor(tab);
    xulTab.addEventListener("click", tabClick);
  });

  //initial tabs that are not handled by tab.on(open)
  if (!options || !options.excludeInitialTabs){
    for (let i in tabs){
      let xulTab = viewFor(tabs[i]);
      xulTab.addEventListener("click", tabClick);

      reason = "opened";
      callback(reason, {number: tabs.length});

      callback("pinned", {number: countPinnedTabs()}); //in order to capture initial pinned tabs/ creates redundancy
    }

    tabs.on('activate', function(tab){
      reason = "activated";
      callback(reason);
    });
  }
}

listener.listenForDownloads = function(callback, options){
  let view = {
    onDownloadAdded: function(download) { 
      console.log("Download added");
      callback('added');
    },
    onDownloadChanged: function(download) {
      console.log("Download changed");
      callback('changed');
    },
    onDownloadRemoved: function(download) {
     console.log("Download removed");
     callback('removed');
    } 
  };

  Task.spawn(function() {
    try {
      downloadList = yield Downloads.getList(Downloads.ALL);
      yield downloadList.addView(view);
    } catch (ex) {
      console.error(ex);
    }
  });
};

listener.listenForChromeEvents = function(callback, options){

  let routesToListenFor = {};

  function evalRoute(route){
      let routeTokens = route.split(" ");
      if (routeTokens[0] === "chrome"){
        let eventName = routeTokens[1];
        let id = routeTokens[2];

        routesToListenFor[[eventName, id].join(" ")] = {
          eventName: eventName,
          id: id
        };
      }
    };

  recommendations.forEach(function(aRecommendation){    
    evalRoute(aRecommendation.trigBehavior);
    evalRoute(aRecommendation.delivContext);
    evalRoute(aRecommendation.featUseBehavior);
  });

  let windowTracker = new WindowTracker({
    onTrack: function(window){
      if (!isBrowser(window)) return;

      for (let routeId in routesToListenFor){
        let route =routesToListenFor[routeId];
        let elem = window.document.getElementById(route.id);
        
        elem.addEventListener(route.eventName, function(evt){
          console.log(elem);
          callback(route.eventName, evt);
        });
      } 
    }
  });

};

//listen for when specific hotkeys are pressed
listener.listenForKeyboardEvent = function(callback, options){
  
  //TODO: merge hotkeys with other chrome events
  let keyTracker = new WindowTracker({
    onTrack: function (window){
      if (!isBrowser(window)) return;   

      window.addEventListener((options && options.eventName) || "keydown", callback );
    }
  });
}

listener.listenForSearchEngine = function(callback){

  let searchService = Cc["@mozilla.org/browser/search-service;1"]
                           .getService(Ci.nsIBrowserSearchService);

  function countNondefaultAlias(engines){
    let c  = 0;
    engines.forEach(function(eng){
      if (eng.alias)
        c = c + 1;
    });

    return c;
  }

  function reportAliasCount(){
    let engines = searchService.getEngines();

    let c = countNondefaultAlias(engines);

    if (c > 0)
      callback("alias", {number: c});
  }

  searchService.init(function(){
    // console.log(engines);
    //TOTHINK: could potentially be done only the first run and make multiple modify events meaningful

    reportAliasCount();
  });

  let modifyTopic = "browser-search-engine-modified";
  searchEngineObserver = {
    observe: function(aEngine, aTopic, aData){
      if (aTopic == modifyTopic){
        callback(aData);
        
        reportAliasCount();
      }
    },
    register: function(){
      Services.obs.addObserver(searchEngineObserver, modifyTopic, false);
    },
    unregister: function(){
      Services.obs.removeObserver(searchEngineObserver, modifyTopic, false);
    }
  }

  searchEngineObserver.register();

};


listener.listenForHistory = function(callback){

  //Create history observer
  let historyObserver = {
    onBeginUpdateBatch: function() {},
    onEndUpdateBatch: function() {
    },
    onVisit: function(aURI, aVisitID, aTime, aSessionID, aReferringID, aTransitionType) {},
    onTitleChanged: function(aURI, aPageTitle) {},
    onBeforeDeleteURI: function(aURI) {},
    onDeleteURI: function(aURI) {
      callback('deletedURI');

    },
    onClearHistory: function() {
      callback('cleared');
    },
    onPageChanged: function(aURI, aWhat, aValue) {},
    onDeleteVisits: function() {
      callback("deletedvisits");
    },
    QueryInterface: XPCOMUtils.generateQI([Ci.nsINavHistoryObserver])
  };

  hs = Cc["@mozilla.org/browser/nav-history-service;1"].
         getService(Ci.nsINavHistoryService);

  hs.addObserver(historyObserver, false);

}

listener.listenForPrivateBrowsing = function(callback){
  windows.browserWindows.on('open', function(window){
    if (require("sdk/private-browsing").isPrivate(window)){
      callback('open');
      
    }
  });
}

listener.listenForSessionStore = function(callback){

  sessObserver = {
    observe: function(subject, topic, data) {
      if (topic == "sessionstore-browser-state-restored"){ //sessionstore... not in Observer Notifications list
        callback("restored");
      }
    },
    register: function() {
      observerService.addObserver(this, "sessionstore-browser-state-restored", false);
    },
    unregister: function() {
      observerService.removeObserver(this, "sessionstore-browser-state-restored");
    }
  };

  sessObserver.register();
}

listener.listenForContentType = function(callback, contentTypes){
  contentTypeObserver = {
    observe: function(subject,topic,data){
      let httpChannel = 
          subject.QueryInterface(Ci.nsIHttpChannel);
      
      let contentType, contentTypeExp;

      try{
        contentTypeExp = httpChannel.getResponseHeader("Content-Type").match(/.*[;\Z]/);
      }
      catch(e){}

      if (contentTypeExp)
        contentType = contentTypeExp[0].slice(0,-1);
      else
        return;
      console.log(contentType);

      let channel = subject.QueryInterface(Ci.nsIChannel);
      let url = channel.URI.spec;
      url = url.toString();

      if (contentTypes.indexOf(contentType) != -1)
        callback(contentType);
      },
    register: function() {
      observerService.addObserver(this, "http-on-examine-response", false);
    },
    unregister: function() {
        observerService.removeObserver(this, "http-on-examine-response");
    }
  };
  contentTypeObserver.register();
}

// listening for command invocations is not useful because the menu items directly call gDevTools functions
listener.listenForDevTools = function(callback){
  let windowTracker = new WindowTracker({
    onTrack: function (window){

      if (!isBrowser(window)) return;

      let gDevTools = window.gDevTools;
      let gBrowser = window.gBrowser
      
      
      gDevTools.on("toolbox-ready", function(e, toolbox){
        let reason = "toolbox-ready";

        let target = devtools.TargetFactory.forTab(gBrowser.selectedTab);
        toolbox = gDevTools.getToolbox(target);

        toolbox.on("select", function(e, toolId){
          let reason = "select";
          callback(reason, {toolId: toolId});
        });

        callback(reason);
      });

      gDevTools.on("select-tool-command", function(e, toolId){
        let reason = "select";
        callback(reason, {toolId: toolId});
      });

    }
  });
};

listener.multipleRoute = function(baseEvent, options){

    if (!options)
      options = {};

    let eventName = options.name || ["multiple", baseEvent.name.slice(0,1).toUpperCase(), baseEvent.name.slice(1)].join("");
    let rEvent = Event(eventName, options.options);
    let that = this;
    
    rEvent.effect = function(){
      let baseRoute = options.baseRoute || baseEvent.options.route;

      let data = eventData[baseRoute];
      
      if (data){
        data.count = (data.count + 1) || 1;
        data.freq = data.count / (timer.elapsedTime() + 1);
        data.ifreq = 1/data.freq;
      }
      else {
        data = {count: 1, freq: 1 / (timer.elapsedTime() + 1), ifreq: timer.elapsedTime()};
      }

      eventData[baseRoute] = data;

      this.options.route = [baseRoute, "-c", String(data.count)].join(" ");
      let route = this.options.route;

      listener.dispatchRoute(route);

      this.options.route = [baseRoute, "-f", String(data.freq)].join(" ");
      route = this.options.route;

      listener.dispatchRoute(route);

      this.options.route = [baseRoute, "-if", String(data.ifreq)].join(" ");
      route = this.options.route;

      listener.dispatchRoute(route);
      

      if (options.addedEffect)
        options.addedEffect();
    };

    return rEvent;
  };

const debug = {
  init: function(){
    handleCmd(this.parseCmd);
  },
  parseCmd: function(cmd){
    const patt = /([^ ]*) *(.*)/; 
    let args = patt.exec(cmd);
    
    if (!args)  //does not match the basic pattern
      return false;

    let name = args[1];
    let params = args[2];

    switch(name){
      case "dispatch":
        listener.dispatchRoute(params);
      break;
      case "behavior":
        listener.behavior(params);
      break;
      case "context":
        listener.context(params);
      break;
      case "featureUse":
        listener.featureUse(params);
      break;
      case "command":
        listener.command(params)
      break;
      default:
        return false;
    }

    return " ";
  }
};


function onUnload(reason){
  if (downloadList) downloadList.removeView();

  if (hs) hs.removeObserver(historyObserver);

  if (sessObserver) sessObserver.unregister();

  if (contentTypeObserver) contentTypeObserver.unregister();

  if (searchEngineObserver) searchEngineObserver.unregister();
}

exports.init = init;
exports.recommendations = recommendations;
exports.onUnload = onUnload;