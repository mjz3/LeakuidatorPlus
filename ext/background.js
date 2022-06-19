"use Exact";

import utils from '../lib/utils.js';

// check if an element exists in array using a comparer function
// comparer : function(currentElement)
Array.prototype.inArray = function(comparer) { 
    for(let i=0; i < this.length; i++) { 
        if(comparer(this[i])) return true; 
    }
    return false;
}; 

// adds an element to the array if it does not already exist using a comparer 
// function
Array.prototype.pushIfNotExist = function(element, comparer) { 
    if (!this.inArray(comparer)) {
        this.push(element);
    }
};

Array.prototype.remove = function(element, comparer) {
    if(this.inArray(comparer)) {
        this.splice(element, 1);
    }
}

// keep track of tabs in a way that is synchronously accessible,
// so that decision to block a request or not does not get stuck on a tab lookup
var tabUrl = []; // current url of each tab
var navigation = [];
var tabPendingUrl = []; // is the tab in a pending state?
var corwc = []; // check if the request is cross origin/site with cookie
var firstResponseHeaders = []; // response headers for the first requests with cookies removed
var xhrData = []; // data related to second request with cookies included
var tabrelations = []; // used to track relations between tabs/windows
var occured = []; // tracks whether a request ID has been observed before

// extension mode (Relaxed or Exact)
var extensionMode = "Relaxed"; // Relaxed is default

// name of storage vars
var keys = ["excludeSite", "excludeOrigin", "ignoreSite", "ignoreOrigin", "mode"];

// headers to be checked for observable difference
var suspiciousHeaders = [ 'status', 'accept', 'content-encoding', 'content-range', 'content-length', 'host',  'etag' ];

var tqf = ["forward_back", "from_address_bar"]; // exclude user initiated navigations

// map of user deciions for ignored requests
// (ignored requests have the protection but user doesn't get notified)
var ignoreSiteMap = []; // based on URL Site
var ignoreOriginMap = []; // based on URL Origin

// map of user decisions for excluded requests
// (excluded requests do not have the protection and user doesn't get notified)
var excludeSiteMap = []; // based on URL Site
var excludeOriginMap = []; // based on URL Origin

// List of dangerous requests for each tab with its current loaded webpage
// A suspicious request is considered dangerous if observable difference is
// detected between two responses to the request with cookies and without cookies.
var dangerousMapPerTab = [];

// handle to the list of public suffixes
var psl;

// handle to Peter Lowe's list
var pll;

// handle to MVPS list
var mvps;

init();

// initialize the extension
function init() {
    
    // load public suffix list
    psl = getPSL();
    publicSuffixList.parse(psl, punycode.toASCII);

    // load filter lists
    pll = getPLL();
    mvps = getMVPS();

    // get prior user decisions/configurations from storage
	config();
	
    // add listener to save user decisions/configurations
    // on storage upon exit
	chrome.windows.onRemoved.addListener(saveDecisions);
    
    // subscribe to events
    chrome.tabs.onCreated.addListener(onTabCreatedListener);
    chrome.tabs.onUpdated.addListener(onTabUpdatedListener);
    chrome.tabs.onRemoved.addListener(onTabRemovedListener);

    chrome.webNavigation.onCompleted.addListener(webNavigationonCompleted);
    chrome.webNavigation.onBeforeNavigate.addListener(webNavigationonBeforeNavigate);
    chrome.webNavigation.onCommitted.addListener(webNavigationonCommitted);
    chrome.webNavigation.onCreatedNavigationTarget.addListener(weNavigationonCreatedNavigationTarget);
    
    chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders,
        {urls: ["https://*/*"]}, ['blocking', 'requestHeaders']);
    chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived,
        {urls: ["https://*/*"]}, ['blocking', 'responseHeaders']);
    
    chrome.runtime.onMessage.addListener(runtimeonMessage);
};

/**
 * if URL in address bar is changing:
 * - reset tab entry in map of dangerous requests
 * - update url entry for the tab
 * - update pending url entry for the tab 
 * @param {the tab Id} tabId 
 * @param {information about tab update} changeInfo 
 * @param {tab info} tab 
 */
 function onTabCreatedListener(tab) {
     if(utils.isEmpty(tabrelations[tab.id])) {
        tabrelations[tab.id] = [];
     }
     if(utils.isEmpty(tabrelations[tab.openerTabId])) {
        tabrelations[tab.openerTabId] = [];
     }
    
    tabUrl[tab.id] = tab.url;
    
    tabrelations[tab.id].push(tab.openerTabId);
    tabrelations[tab.openerTabId].push(tab.id);
};


/**
 * if URL in address bar is changing:
 * - reset tab entry in map of dangerous requests
 * - update url entry for the tab
 * - update pending url entry for the tab 
 * @param {the tab Id} tabId 
 * @param {information about tab update} changeInfo 
 * @param {tab info} tab 
 */
function onTabUpdatedListener(tabId, changeInfo, tab) {
    if(!utils.isEmpty(changeInfo.url)) {dangerousMapPerTab[tabId] = [];}
    tabUrl[tabId] = tab.url;
    tabPendingUrl[tabId] = tab.pendingUrl;
};

/**
 * delete tab url and pending url entries
 * @param {tab Id} tabId 
 */
function onTabRemovedListener(tabId) {
    delete tabUrl[tabId];
    delete tabPendingUrl[tabId];
    delete tabrelations[tabId];
};


function weNavigationonCreatedNavigationTarget(details) {

    if(details.frameId == 0) {
        tabUrl[details.tabId] = details.url;
    }

    if(details.tabId != details.sourceTabId) {
        if(utils.isEmpty(tabrelations[details.tabId])) {
            tabrelations[details.tabId] = [];
         }
         if(utils.isEmpty(tabrelations[details.sourceTabId])) {
            tabrelations[details.sourceTabId] = [];
         }

        tabrelations[details.tabId].push(details.sourceTabId);
        tabrelations[details.sourceTabId].push(details.tabId);
    }
}

/**
 * mark if tab is in navigating state
 * @param {request details} details 
 */
function webNavigationonBeforeNavigate(details){
    if(details.frameId == 0) {
        navigation[details.tabId] = true;
        tabUrl[details.tabId] = details.url;
    }
};

/**
 * unmark when tab is not in navigating state
 * @param {request details} details 
 */
function webNavigationonCommitted(details){
    if(details.frameId == 0) {
        delete navigation[details.tabId];
        tabUrl[details.tabId] = details.url;

        // if transision type is not link, remove this tab from relations

        if(tabrelations[details.tabId] &&
            !(details.transitionType == "link" && !details.transitionQualifiers.some(r => tqf.indexOf(r) >= 0))) {
            for (let i = 0; i < tabrelations[details.tabId].length; ++i) {
                const relatedTab = tabrelations[details.tabId][i];
                if(tabrelations[relatedTab]) {
                    tabrelations[relatedTab] = tabrelations[relatedTab].filter(function(x) {
                        return x !== details.tabId;
                    });
                }
            }

            delete tabrelations[details.tabId];
        }
    }
};

/**
 * - purge and clean map of dangerous request
 * - update extension notification bar
 * @param {request details} details 
 */
function webNavigationonCompleted(details) {

    if(details.frameId == 0) {

        tabUrl[details.tabId] = details.url;

        // remove user's decided mappings from the list
        if(extensionMode == "Relaxed") {
            dangerousMapPerTab[details.tabId] = utils.purgesuspiciousMapForTab(dangerousMapPerTab[details.tabId], excludeSiteMap, ignoreSiteMap);
        } else if(extensionMode == "Exact"){
            dangerousMapPerTab[details.tabId] = utils.purgesuspiciousMapForTab(dangerousMapPerTab[details.tabId], excludeOriginMap, ignoreOriginMap);
        }

        // set notification for user
        chrome.browserAction.setBadgeBackgroundColor({ color: [102, 102, 102, 255] });
        var number  = utils.isEmpty(dangerousMapPerTab[details.tabId]) ? 0 : dangerousMapPerTab[details.tabId].length;
        chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});
    }
};

/**
 * - check if a request is suspicious, based on 7 conditions
 * - if suspicious, store request data, for @xhRequest
 * @param {details of request} details 
 */
function onBeforeSendHeaders(details) {

    if(details.tabId == -1) {
        //delete requestBody[details.requestId];
        return { requestHeaders: details.requestHeaders };
    }
    
    // condition: check if it is a GET or HEAD request
    let method = details.method;
    if(method == undefined){
        return { requestHeaders: details.requestHeaders};
    }

    // condition: check if request contains cookies
    if(!utils.headerExists(details, "Cookie")) {
        return { requestHeaders: details.requestHeaders };
    }

    // extract Sec-Fetch header values
    // let fetchSite = utils.headerValue(details.requestHeaders, "Sec-Fetch-Site"); // this seems to be unreliable
    let fetchDest = utils.headerValue(details.requestHeaders, "Sec-Fetch-Dest");
    let fetchMode = utils.headerValue(details.requestHeaders, "Sec-Fetch-Mode");
    
    // condition: to handle a behaviour similar to SameSite=Lax, check if the page is navigating.
    // if so, there are two cases:
    // 1: there is no relation with any other tab,
    // so the request can be excluded from protection,
    // because nothing can be learned after navigation
    // 2: if there is a relation with another tab,
    // the protection should be active against those tabs,
    // because another tab may learn something from
    // this tab after navigation
    let navigationFlag = false;
    if(fetchMode == "navigate" && fetchDest == "document") {
        if(tabrelations[details.tabId]) {
            navigationFlag = true;
        } else {
            return { requestHeaders: details.requestHeaders };
        }
    }

    // extract information about target of request
    let trgt = details.url;
    let targetSite = utils.getSiteFromUrl(trgt);
    let targetOrigin = utils.combineOrigin(utils.getOriginFromUrl(trgt));

    
    // extract information about source of request
    let src = tabUrl[details.tabId];
    let sourceSite = utils.getSiteFromUrl(src);
    let sourceOrigin = utils.combineOrigin(utils.getOriginFromUrl(src));

    // condition: whether it is a cross-site/cross-origin request
    let modeConditions = false;

    // condition: check if tab URL is determined
    if(tabUrl[details.tabId] && !navigationFlag) {
        // condition: check if the tab is in navigation state, and
        // condition: whether the tab URL is valid
        if((navigation[details.tabId] == true && !tabrelations[details.tabId]) ||
            (!utils.isEmpty(tabPendingUrl[details.tabId]) && tabUrl[details.tabId].toLowerCase() !== tabPendingUrl[details.tabId].toLowerCase()) ||
            details.tabId == -1 ||
            tabUrl[details.tabId].toLowerCase().startsWith("chrome://newtab/") ||
            tabUrl[details.tabId].toLowerCase().startsWith("chrome-extension://") ||
            tabUrl[details.tabId].toLowerCase().startsWith("edge://newtab/")) {
            return { requestHeaders: details.requestHeaders };
        }

        if(extensionMode == "Relaxed") {
            // check Relaxed conditions on the request
            if(!utils.isEmpty(sourceSite) && !utils.isEmpty(targetSite)) {
                modeConditions = (/*(!utils.isEmpty(fetchSite) && fetchSite == "cross-site") ||*/ utils.crossSite(sourceSite, targetSite) ? true : false);
            }
        } else if(extensionMode == "Exact") {
            // check Exact conditions on the request
            if (!utils.isEmpty(sourceOrigin) && !utils.isEmpty(targetOrigin)) {
                modeConditions = (/*(!utils.isEmpty(fetchSite) && fetchSite != "same-origin" && fetchSite != "none") ||*/ utils.crossOrigin(sourceOrigin, targetOrigin)? true : false);
            }
        }
    }

    let excludeFlag;
    if(modeConditions) {
        // condition: check if request was excluded from protection, by a prior user decision
        excludeFlag  = (((extensionMode == "Relaxed" && utils.isSiteExcluded(sourceSite, targetSite, excludeSiteMap)) ||
        (extensionMode == "Exact" && utils.isOriginExcluded(sourceOrigin, targetOrigin, excludeOriginMap))) ? true : false);
        if(excludeFlag) {
            modeConditions = false;
        }
    }

    if(!modeConditions && tabrelations[details.tabId]) {
        
        for(let i = 0; i < tabrelations[details.tabId].length && !modeConditions; i++) 
        {
            let srctmp = tabUrl[tabrelations[details.tabId][i]];
            if(!srctmp) {
                continue;
            } else {
                src = srctmp;
            }
            sourceSite = utils.getSiteFromUrl(src);
            sourceOrigin = utils.combineOrigin(utils.getOriginFromUrl(src));

            if(extensionMode == "Relaxed") {
                // check Relaxed conditions on the request
                if(!utils.isEmpty(sourceSite) && !utils.isEmpty(targetSite)) {
                    modeConditions = (/*(!utils.isEmpty(fetchSite) && fetchSite == "cross-site") ||*/ utils.crossSite(sourceSite, targetSite) ? true : false);
                }
            } else if(extensionMode == "Exact") {
                // check Exact conditions on the request
                if (!utils.isEmpty(sourceOrigin) && !utils.isEmpty(targetOrigin)) {
                    modeConditions = (/*(!utils.isEmpty(fetchSite) && fetchSite != "same-origin" && fetchSite != "none") ||*/ utils.crossOrigin(sourceOrigin, targetOrigin)? true : false);
                }
            }

            excludeFlag  = (((extensionMode == "Relaxed" && utils.isSiteExcluded(sourceSite, targetSite, excludeSiteMap)) ||
            (extensionMode == "Exact" && utils.isOriginExcluded(sourceOrigin, targetOrigin, excludeOriginMap))) ? true : false);

            if(excludeFlag) {
                modeConditions = false;
            }

            if(modeConditions) {
                break;
            }
        }
    }

    if(!modeConditions) {
        return { requestHeaders: details.requestHeaders };
    }

    // last condition: is it ad or tracking?
    // currently disabled (experimental feature)
    /*
    if(utils.findProxyForURL(mvps, details.url) || utils.findProxyForURL(pll, details.url)) {
        return { requestHeaders: details.requestHeaders };
    }
    */
    
    // if survived all the conditions, mark the request as suspicious
    if(!corwc[details.requestId]) {

        corwc[details.requestId] = true;

        // store first request data, to be used by @xhRequest
        xhrData[details.requestId] = [];
        xhrData[details.requestId].id = details.requestId;
        //xhrData[details.requestId].method = details.method;
        //xhrData[details.requestId].headers = copiedHeaders;
        //xhrData[details.requestId].body = requestBody[details.requestId];
        xhrData[details.requestId].tabId = details.tabId;
        xhrData[details.requestId].source = src;
        xhrData[details.requestId].target = trgt;    
    } else {
        occured[details.requestId] = true;
    }
    
    return { requestHeaders: utils.removeRequestHeaders(details, 'Cookie') };
};

/**
 * - store first response headers for suspicious requests
 * into memory, to be used by @xhRequest
 * - remove Set-Cookie from response headers
 * - make second request for suspicious requests, by @xhRequest
 * @param {details of the request} details 
 */
function onHeadersReceived(details) {

    // check if it was marked as suspicious
    if(corwc[details.requestId]) {

        // if there are multiple events fired for one requestId,
        // evaluate them only once (tracked with occured variable)
        // so corwc requests are evaluated only one time for
        // any distinguishable  differences
        if(!occured[details.requestId]) {

            // store response headers into memory for later use by @xhRequest
            firstResponseHeaders[details.requestId] = [];
            for(var i = 0, l = details.responseHeaders.length; i < l; i++) {
                let hdr = details.responseHeaders[i].name.toLowerCase();
                if(suspiciousHeaders.includes(hdr)) {
                    firstResponseHeaders[details.requestId][hdr] = details.responseHeaders[i].value.toLowerCase();
                }
            }

            // make the second request, with cookies
            setTimeout(xhRequest, Math.random() * 1000, details.requestId);
        }
        // return response to first request, with Set-Cookie header removed
        return { responseHeaders: utils.removeResponseHeaders(details, 'Set-Cookie') };
    }
};

/**
 * Listen to messages from the content script and popup page
 * @param {message received} msg 
 * @param {sender of the message} sender 
 * @param {response to the message} sendResponse 
 */
function runtimeonMessage(msg, sender, sendResponse) {
    switch(msg.type) {
        case "getSuspiciousList": {
            chrome.tabs.query({active: true}, function(results) {
                let activeTabId = results[0].id;
                
                // remove user decided mappings from the list
                if(extensionMode == "Relaxed") {
                    dangerousMapPerTab[activeTabId] = utils.purgesuspiciousMapForTab(dangerousMapPerTab[activeTabId], excludeSiteMap, ignoreSiteMap);
                } else {
                    dangerousMapPerTab[activeTabId] = utils.purgesuspiciousMapForTab(dangerousMapPerTab[activeTabId], excludeOriginMap, ignoreOriginMap);
                }

                // set notification for user
                chrome.browserAction.setBadgeBackgroundColor({ color: [102, 102, 102, 255] });
                let number  = utils.isEmpty(dangerousMapPerTab[activeTabId]) ? 0 : dangerousMapPerTab[activeTabId].length;
                chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});

                sendResponse({val: dangerousMapPerTab[activeTabId]});
            });
            return true;
        }
        case "excludeSite": {
            let element = [msg.source, msg.target];
            excludeSiteMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "excludeOrigin": {
            let element = [msg.source, msg.target];
            excludeOriginMap.pushIfNotExist(element, function(e) {
                return e[0] == element[0] && e[1] == element[1];
            });
            return true;
        }
        case "excludeSiteAll": {
            let element = ['*', msg.target];
            excludeSiteMap.pushIfNotExist(element, function(e) {
                return e[0] == element[0] && e[1] == element[1];
            });
            return true;
        }
        case "excludeOriginAll": {
            let element = ['*', msg.target];
            excludeOriginMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "ignoreSite": {
            let element = [msg.source, msg.target];
            ignoreSiteMap.pushIfNotExist(element, function(e) {
                return e[0] == element[0] && e[1] == element[1];
            });
            return true;
        }
        case "ignoreOrigin": {
            let element = [msg.source, msg.target];
            ignoreOriginMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "ignoreSiteAll": {
            let element = ['*', msg.target];
            ignoreSiteMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "ignoreOriginAll": {
            let element = ['*', msg.target];
            ignoreOriginMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "getExcludeSiteList": {
            sendResponse({val: excludeSiteMap});
            return true;
        }
        case "getExcludeOriginList": {
            sendResponse({val: excludeOriginMap});
            return true;
        }
        case "getIgnoreSiteList": {
            sendResponse({val: ignoreSiteMap});
            return true;
        }
        case "getIgnoreOriginList": {
            sendResponse({val: ignoreOriginMap});
            return true;
        }
        case "saveMode": {
            extensionMode = msg.mode;
            chrome.storage.local.set({"mode": JSON.stringify(extensionMode)}, function() { console.log("mode saved"); } );
            return true;
        }
        case "getMode": {
            sendResponse({val: extensionMode});
            return true;
        }
        case "removeExcludeSite": {
            let element = [msg.source, msg.target];
            excludeSiteMap = excludeSiteMap.filter(function(e) {
                return e[0] != element[0] || e[1] != element[1];
            });
            return true;
        }
        case "removeExcludeOrigin": {
            let element = [msg.source, msg.target];
            excludeOriginMap = excludeOriginMap.filter(function(e) {
                return e[0] != element[0] || e[1] != element[1];
            });
            return true;
        }
        case "removeIgnoreSite": {
            let element = [msg.source, msg.target];
            ignoreSiteMap = ignoreSiteMap.filter(function(e) {
                return e[0] != element[0] || e[1] != element[1];
            });
            return true;
        }
        case "removeIgnoreOrigin": {
            let element = [msg.source, msg.target];
            ignoreOriginMap = ignoreOriginMap.filter(function(e) {
                return e[0] != element[0] || e[1] != element[1];
            });
            return true;
        }
        default: {
            return true;   
        }
    }
};

/**
 * restore configurations/decisions from local storage
 */ 
function config() {
    chrome.storage.local.get(keys, function(items) {

		let storageExcludeSite = items.excludeSite;
		if (storageExcludeSite) {
			excludeSiteMap = JSON.parse(storageExcludeSite);
		}
        
        let storageExcludeOrigin = items.excludeOrigin;
		if (storageExcludeOrigin) {
			excludeOriginMap = JSON.parse(storageExcludeOrigin);
        }
        
		let storageIgnoreSite = items.ignoreSite;
		if (storageIgnoreSite) {
            ignoreSiteMap = JSON.parse(storageIgnoreSite);
        }

		let storageIgnoreOrigin = items.ignoreOrigin;
		if (storageIgnoreOrigin) {
            ignoreOriginMap = JSON.parse(storageIgnoreOrigin);
        }

        let storageMode = items.mode;
		if (storageMode) {
            extensionMode = JSON.parse(storageMode);
        }
    });
};

/**
 * Save configurations/decisions to local storage
 */
function saveDecisions() {
    chrome.storage.local.set({"excludeSite": JSON.stringify(excludeSiteMap)});
    chrome.storage.local.set({"excludeOrigin": JSON.stringify(excludeOriginMap)});
    chrome.storage.local.set({"ignoreSite": JSON.stringify(ignoreSiteMap)});
    chrome.storage.local.set({"ignoreOrigin": JSON.stringify(ignoreOriginMap)});
    chrome.storage.local.set({"mode": JSON.stringify(extensionMode)});
};

/**
 * - make a similar request to first request, but with cookies
 * - check response to both requests for observable differences
 * - notify user if request is deemed dangerous and not ignored before
 * @param {first response headrs} responseOneData 
 * @param {first request headers} requestOnedata 
 */
function xhRequest(rId) {
    let responseOneData = firstResponseHeaders[rId];
    let requestOnedata = xhrData[rId];

    // prepare an instance of XMLHttpRequest, for a second request with cookies
    let request = new XMLHttpRequest();
    if(requestOnedata) {
        request.open('HEAD'/*requestOnedata.method*/, requestOnedata.target, true);
    } else {
        return;
    }

    // add the cookies to the request
    request.withCredentials = true;

    // add a listener to compare two responses,
    // upon arrival of second response
    request.onreadystatechange = function() {

        // trigger when second response headers received
        if(this.readyState == this.HEADERS_RECEIVED) {
            performance.clearResourceTimings();
            // check for observable differences between two responses
            if(!utils.headersEqual(responseOneData, utils.getHeaderMap(request.getAllResponseHeaders()))) {

                // it is a dangerous request!

                // extract Site/Origin data from source and target of a request
                let targetSite = utils.getSiteFromUrl(requestOnedata.target);
                let targetOrigin = utils.combineOrigin(utils.getOriginFromUrl(requestOnedata.target));
                let sourceSite = utils.getSiteFromUrl(requestOnedata.source);
                let sourceOrigin = utils.combineOrigin(utils.getOriginFromUrl(requestOnedata.source));
                
                // prepare element to compare with past user decisions
                let element = [];
                if(extensionMode == "Relaxed") {
                    element = [sourceSite, targetSite];
                } else if(extensionMode == "Exact") {
                    element = [sourceOrigin, targetOrigin];
                }

                // check if the request is ignored by user in the past decisions
                let ignoreFlag = (((extensionMode == "Relaxed" && utils.isSiteIgnored(sourceSite, targetSite, ignoreSiteMap)) ||
                (extensionMode == "Exact" && utils.isOriginIgnored(sourceOrigin, targetOrigin, ignoreOriginMap))) ? true : false);

                // user needs to know about this dangerous request
                if(!ignoreFlag) {
                    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                        var currTab = tabs[0];
                        if (currTab) {
                            // init the map for the tab
                            if(utils.isEmpty(dangerousMapPerTab[currTab.id])) {
                                dangerousMapPerTab[currTab.id] = [];
                            }

                            // add to dangerous map
                            dangerousMapPerTab[currTab.id].pushIfNotExist(element, function(e) {
                                return e[0] == element[0] && e[1] == element[1];
                            });

                            // set notification for user
                            chrome.browserAction.setBadgeBackgroundColor({ color: [102, 102, 102, 255] });
                            var number  = utils.isEmpty(dangerousMapPerTab[currTab.id]) ? 0 : dangerousMapPerTab[currTab.id].length;
                            chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});
                        }
                    });
                }
            }
        }

        // Check for errors
        if(this.readyState === this.DONE) {
            let status = this.status;
            if (status === 0 || (status >= 200 && status < 400)) {
                delete xhrData[requestOnedata.id];
                delete firstResponseHeaders[requestOnedata.id];
            } else {
                // There has been an error with the request!
                // it is dangerous!

                // extract Site/Origin data from source and target of a request
                let targetSite = utils.getSiteFromUrl(requestOnedata.target);
                let targetOrigin = utils.combineOrigin(utils.getOriginFromUrl(requestOnedata.target));
                let sourceSite = utils.getSiteFromUrl(requestOnedata.source);
                let sourceOrigin = utils.combineOrigin(utils.getOriginFromUrl(requestOnedata.source));
                
                // prepare element to compare with past user decisions
                let element = [];
                if(extensionMode == "Relaxed") {
                    element = [sourceSite, targetSite];
                } else if(extensionMode == "Exact") {
                    element = [sourceOrigin, targetOrigin];
                }

                // check if the request is ignored by user in the past decisions
                let ignoreFlag = (((extensionMode == "Relaxed" && utils.isSiteIgnored(sourceSite, targetSite, ignoreSiteMap)) ||
                (extensionMode == "Exact" && utils.isOriginIgnored(sourceOrigin, targetOrigin, ignoreOriginMap))) ? true : false);
                // user needs to know about this dangerous request
                if(!ignoreFlag) {
                    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                        var currTab = tabs[0];
                        if (currTab) {
                            // init the map for the tab
                            if(utils.isEmpty(dangerousMapPerTab[currTab.id])) {
                                dangerousMapPerTab[currTab.id] = [];
                            }

                            // add to dangerous map
                            dangerousMapPerTab[currTab.id].pushIfNotExist(element, function(e) {
                                return e[0] == element[0] && e[1] == element[1];
                            });

                            // set notification for user
                            chrome.browserAction.setBadgeBackgroundColor({ color: [102, 102, 102, 255] });
                            var number  = utils.isEmpty(dangerousMapPerTab[currTab.id]) ? 0 : dangerousMapPerTab[currTab.id].length;
                            chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});
                        }
                    });
                }
                
                // these information are no longer needed
                delete xhrData[requestOnedata.id];
                delete firstResponseHeaders[requestOnedata.id];
            }
        }
    }

    // send the second request with cookies
    request.send(/*params*/);
};
