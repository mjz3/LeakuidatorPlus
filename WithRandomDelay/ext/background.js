"use strict";
// var to count number of suspicious requests
var susCount = 0;
// var to count number of dangerous requests
var danCount = 0;
// need to keep track of tabs in a way that's synchronously accessible
// (so that decision to block a request or not doesn't get stuck on tab lookup)
var tabUrl = []; // current url of tab
//var requestReferer= [];
var navigation = [];
var tabPendingUrl = []; // is the tab in a pending state?
var requestBody = []; // body of request - extracted from first request - is needed to make second request
var corwc = []; // check if it's cross origin request with cookie
var firstResponseHeaders = []; // response headers for the first requests with cookies removed
var xhrData = []; // data related to second request with cookies included
var occured = []; // only first occurrence of a request is monitored identified by request Id
var tabrelations = [];

// default extension mode
var extensionMode = "lax"; // lax or strict

// name of storage vars
var keys = ["excludeSite", "excludeOrigin", "ignoreSite", "ignoreOrigin", "mode"];
// map of user deciions for ignored requests.
// ignored requests have the protection but user doesn't get notified
var ignoreSiteMap = []; // based on URL Site
var ignoreOriginMap = []; // based on URL Origin

// map of user decisions for excluded requests.
// excluded requests do not have the protection and user doesn't get notified
var excludeSiteMap = []; // based on URL Site
var excludeOriginMap = []; // based on URL Origin

// List of dangerous requests for each tab with its current loaded webpage
// A suspicious request is considered dangerous if observable difference is
// detected between two responses to the request with cookies and without cookies.
var dangerousMapPerTab = [];

// handle to other libraries
//var fs; // file system
var pnc; // punnycode
var pslLib; // public suffix list library

// handle to the list of public suffixes
var data;


init();

// initialize the extension
function init() {

    // init the handle to libraries
    pslLib = getSuffixList();
    pnc = getPunycode();
    let psl = getData();
    
    // load public suffix list
    pslLib.parse(psl, pnc.toASCII);

    // get prior user decisions/configurations from storage
	config();
	
    // add listener to save user decisions/configurations
    // on storage upon exit
	chrome.windows.onRemoved.addListener(saveDecisions);
    
    // subscribe to events
    chrome.tabs.onCreated.addListener(onTabCreatedListener);
    chrome.tabs.onUpdated.addListener(onTabUpdatedListener);
    chrome.tabs.onRemoved.addListener(onTabRemovedListener);

    chrome.webNavigation.onCompleted.addListener(webNavigationonCompleted,
        {urls: ['<all_urls>']});
    chrome.webNavigation.onBeforeNavigate.addListener(webNavigationonBeforeNavigate,
        {urls: ['<all_urls>']});
    chrome.webNavigation.onCommitted.addListener(webNavigationonCommitted,
        {urls: ['<all_urls>']});
    chrome.webNavigation.onCreatedNavigationTarget.addListener(weNavigationonCreatedNavigationTarget,
        {urls: ['<all_urls>']});
    
    chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest,
        {urls: ["https://*/*"]}, [ 'blocking', 'requestBody' ]);
    chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders,
        {urls: ["https://*/*"]}, ['blocking', 'requestHeaders', 'extraHeaders']);
    chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived,
        {urls: ["https://*/*"]}, ['blocking', 'responseHeaders', 'extraHeaders']);
    
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
     if(isEmpty(tabrelations[tab.id])) {
        tabrelations[tab.id] = [];
     }
     if(isEmpty(tabrelations[tab.openerTabId])) {
        tabrelations[tab.openerTabId] = [];
     }
    
    tabUrl[tab.id] = tab.url;
    
    tabrelations[tab.id].push(tab.openerTabId);
    tabrelations[tab.openerTabId].push(tab.id);

    //console.log("onTabCreatedListener event: tab id: " + tab.id + " the array: " + tabrelations[tab.id] + " taburl: " + tabUrl[tab.id]);
    //console.log("onTabCreatedListener event: tab oppener id: " + tab.openerTabId + " the array: " + tabrelations[tab.openerTabId] + " taburl: " + tabUrl[tab.openerTabId]);
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
    if(!isEmpty(changeInfo.url)) {dangerousMapPerTab[tabId] = [];}
    tabUrl[tabId] = tab.url;
    tabPendingUrl[tabId] = tab.pendingUrl;
    //console.log("onTabUpdatedListener event: tab id: " + tabId + " the array: " + tabrelations[tabId] + " taburl: " + tabUrl[tabId]);
};

/**
 * delete tab url and pending url entries
 * @param {tab Id} tabId 
 */
function onTabRemovedListener(tabId) {
    //console.log("onTabRemovedListener event: tab id: " + tabId + " the array: " + tabrelations[tabId] + " taburl: " + tabUrl[tabId]);
    //delete urlToTab[tabUrl[tabId]];
    delete tabUrl[tabId];
    delete tabPendingUrl[tabId];
    delete tabrelations[tabId];
};


function weNavigationonCreatedNavigationTarget(details) {
    if(isEmpty(tabrelations[details.tabId])) {
        tabrelations[details.tabId] = [];
     }
     if(isEmpty(tabrelations[details.sourceTabId])) {
        tabrelations[details.sourceTabId] = [];
     }
    
    //tabUrl[details.tabId] = tab.url;
    
    tabrelations[details.tabId].push(details.sourceTabId);
    tabrelations[details.sourceTabId].push(details.tabId);

    //console.log("weNavigationonCreatedNavigationTarget event: tab id: " + details.tabId + " the array: " + tabrelations[details.tabId] + " taburl: " + tabUrl[details.tabId]);
    //console.log("weNavigationonCreatedNavigationTarget event: tab oppener id: " + details.sourceTabId + " the array: " + tabrelations[details.sourceTabId] + " taburl: " + tabUrl[details.sourceTabId]);
}

/**
 * mark if tab is in navigating state
 * @param {request details} details 
 */
function webNavigationonBeforeNavigate(details){
    if(details.frameId == 0) {
        navigation[details.tabId] = true;
    }
};

/**
 * unmark when tab is not in navigating state
 * @param {request details} details 
 */
function webNavigationonCommitted(details){
    if(details.frameId == 0) {
        delete navigation[details.tabId];
    }
};

/**
 * - purge and clean map of dangerous request
 * - update extension notification bar
 * @param {request details} details 
 */
function webNavigationonCompleted(details) {

    if(details.frameId == 0) {
        // remove user's decided mappings from the list
        if(extensionMode == "lax") {
            dangerousMapPerTab[details.tabId] = purgesuspiciousMapForTab(dangerousMapPerTab[details.tabId], excludeSiteMap, ignoreSiteMap);
        } else if(extensionMode == "strict"){
            dangerousMapPerTab[details.tabId] = purgesuspiciousMapForTab(dangerousMapPerTab[details.tabId], excludeOriginMap, ignoreOriginMap);
        }

        // set notification for user
        chrome.browserAction.setBadgeBackgroundColor({ color: [255, 0, 0, 255] });
        var number  = isEmpty(dangerousMapPerTab[details.tabId]) ? 0 : dangerousMapPerTab[details.tabId].length;
        chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});
    }
};

/**
 * store request body
 * @todo make sure you remove the request body at the end of request cycle
 * @param {request details} details 
 */
function onBeforeRequest(details) {
    try {
        requestBody[details.requestId] = ( isEmpty(details.requestBody) || isEmpty(details.requestBody.raw || isEmpty(isEmpty(details.requestBody.raw[0]))) ? undefined : decodeURIComponent(String.fromCharCode.apply(null,
            new Uint8Array(details.requestBody.raw[0].bytes))));
    } catch(err) {
        requestBody[details.requestId] = undefined;
    }
};

/**
 * - check if a request is suspicious, based on 7 conditions
 * - if suspicious, store request data, for @xhRequest
 * @param {details of request} details 
 */
function onBeforeSendHeaders(details) {

    if(details.tabId == -1) {
        delete requestBody[details.requestId];
        return { requestHeaders: details.requestHeaders };
    }

    //console.log(details.requestId + " " + details.url + " tab: " + details.tabId + " tabulr: " + tabUrl[details.tabId] + " urlToTab: " + urlToTab[getSiteFromUrl(tabUrl[details.tabId])]);
    
    
    
    // condition 0: check if it is a GET or HEAD request
    let method = details.method;
    if(method == undefined /*||
    ((method.toLowerCase() != "get") && (method.toLowerCase() != "head"))*/){
        //console.log(details.requestId + " " + details.url + " method undefined!");
        delete requestBody[details.requestId];
        return { requestHeaders: details.requestHeaders};
    }

    // condition 4: check if request contains cookies
    if(!headerExists(details, "Cookie")) {
        console.log(details.requestId + " " + details.url + " no cookies!");
        // lacks root cause of leaky resource attacks
        delete requestBody[details.requestId];
        return { requestHeaders: details.requestHeaders };
    }

    // extract Sec-Fetch header values
    let fetchSite = headerValue(details.requestHeaders, "Sec-Fetch-Site");
    let fetchDest = headerValue(details.requestHeaders, "Sec-Fetch-Dest");
    let fetchMode = headerValue(details.requestHeaders, "Sec-Fetch-Mode");

    // condition 5: chech if the request is navigation to a document
    /*
    if(fetchMode == "navigate" && fetchDest == "document" && !tabrelations[details.tabId]) {
        console.log(details.requestId + " " + details.url + "navigate and document!");
        // corresponds to allowed SameSite=Lax conditions, and are excempted from protection
        delete requestBody[details.requestId];
        return { requestHeaders: details.requestHeaders };
    }
    */

    
    // extract information about target of request
    let trgt = details.url;
    let targetSite = getSiteFromUrl(trgt);
    let targetOrigin = combineOrigin(getOriginFromUrl(trgt));

    
    // extract information about source of request
    let src = tabUrl[details.tabId];
    let sourceSite = getSiteFromUrl(src);
    let sourceOrigin = combineOrigin(getOriginFromUrl(src));

    
    // condition 6: check if it is a cross-site/cross-origin request
    let modeConditions = false;

    // condition 1: check if tab URL is determined
    if(tabUrl[details.tabId]) {
        // condition 2: check if the tab is in navigation state, and
        // condition 3: whether the tab URL is valid
        if((navigation[details.tabId] == true && !tabrelations[details.tabId]) ||
            (!isEmpty(tabPendingUrl[details.tabId]) && tabUrl[details.tabId].toLowerCase() !== tabPendingUrl[details.tabId].toLowerCase()) ||
            details.tabId == -1 ||
            startsWith(tabUrl[details.tabId].toLowerCase(), "chrome://newtab/") == true ||
            startsWith(tabUrl[details.tabId].toLowerCase(), "chrome-extension://") == true ||
            startsWith(tabUrl[details.tabId].toLowerCase(), "edge://newtab/") == true) {
                console.log(details.requestId + " " + details.url + " new tab!");
            delete requestBody[details.requestId];
            return { requestHeaders: details.requestHeaders };
        }

        if(extensionMode == "lax") {
            // check lax conditions on the request
            if(!isEmpty(sourceSite) && !isEmpty(targetSite)) {
                modeConditions = ((!isEmpty(fetchSite) && fetchSite == "cross-site") || crossSite(sourceSite, targetSite) ? true : false);
            }
        } else if(extensionMode == "strict") {
            // check strict conditions on the request
            if (!isEmpty(sourceOrigin) && !isEmpty(targetOrigin)) {
                modeConditions = ((!isEmpty(fetchSite) && fetchSite != "same-origin" && fetchSite != "none") || crossOrigin(sourceOrigin, targetOrigin)? true : false);
            }
        }
    }

    if(!modeConditions && tabrelations[details.tabId]) {
        
        for(let i = 0; i < tabrelations[details.tabId].length && !modeConditions; i++) 
        {
            let srctmp = tabUrl[tabrelations[details.tabId][i]];
            //console.log("related tab: " + tabrelations[details.tabId][i] + " its url: " + tabUrl[tabrelations[details.tabId][i]]);
            if(!srctmp) {
                continue;
            } else {
                src = srctmp;
            }
            console.log(details.requestId + " " + details.url + " related tabid:" + tabrelations[details.tabId][i] + " url: " + src);
            sourceSite = getSiteFromUrl(src);
            sourceOrigin = combineOrigin(getOriginFromUrl(src));
            if(extensionMode == "lax") {
                // check lax conditions on the request
                if(!isEmpty(sourceSite) && !isEmpty(targetSite)) {
                    modeConditions = ((!isEmpty(fetchSite) && fetchSite == "cross-site") || crossSite(sourceSite, targetSite) ? true : false);
                }
            } else if(extensionMode == "strict") {
                // check strict conditions on the request
                if (!isEmpty(sourceOrigin) && !isEmpty(targetOrigin)) {
                    modeConditions = ((!isEmpty(fetchSite) && fetchSite != "same-origin" && fetchSite != "none") || crossOrigin(sourceOrigin, targetOrigin)? true : false);
                }
            }
            if(modeConditions) {
                break;
            }
        }
    }

    if(!modeConditions) {
        console.log(details.requestId + " " + details.url + " mode conditions false! src: " + src + " and the relations: " + tabrelations[details.tabId]);
        delete requestBody[details.requestId];
        return { requestHeaders: details.requestHeaders };
    }

    // condition 7: check if request was excluded from protection, by a past user decision
    let excludeFlag = (((extensionMode == "lax" && isSiteExcluded(sourceSite, targetSite, excludeSiteMap)) ||
        (extensionMode == "strict" && isOriginExcluded(sourceOrigin, targetOrigin, excludeOriginMap))) ? true : false);
    if(excludeFlag) {
        //console.log(details.requestId + " " + details.url + " excluded!");
        delete requestBody[details.requestId];
        return { requestHeaders: details.requestHeaders };
    }
    
    // if survived the 7 conditions, mark the request as suspicious
    corwc[details.requestId] = true;
    /*console.log(details.requestId + " corwc set. extMode: " + extensionMode + " excludeFlag: " + excludeFlag +
        " laxConditions: " + laxConditions + " strictCondtions: " + strictConditions + " fetchMode: " + fetchMode +
        " fetchSite " + fetchSite + " fetchDest: " + fetchDest +  " from " + src + " to " + trgt);*/
    
    // copy headers to a new array, to survive
    let copiedHeaders = returnHeaders(details);
    

    // store first request data, to be used by @xhRequest
    xhrData[details.requestId] = [];
    xhrData[details.requestId].id = details.requestId;
    xhrData[details.requestId].method = details.method;
    xhrData[details.requestId].headers = copiedHeaders;
    xhrData[details.requestId].body = requestBody[details.requestId];
    xhrData[details.requestId].tabId = details.tabId;
    xhrData[details.requestId].source = src;
    xhrData[details.requestId].target = trgt;
    
    delete requestBody[details.requestId];
    ////console.log(details.requestId + " origin: " + originDomain + " target: " + targetDomain + " onBeforeSendHeaders: modified first request!");

    // let the first request go through, with cookies removed
    return { requestHeaders: removeRequestHeaders(details, 'Cookie') };
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
    if(corwc[details.requestId] == true) {
        // if there are multiple events fired for one requestId,
        // evaluate them only once (tracked with occured variable)
        // so corwc requests are evaluated only one time for
        // the distinguishable  differences
        if(occured[details.requestId] != true) {
            occured[details.requestId] = true;
            // store response headers into memory for later use by @xhRequest
            firstResponseHeaders[details.requestId] = [];
            for(var i = 0, l = details.responseHeaders.length; i < l; i++) {
                firstResponseHeaders[details.requestId][details.responseHeaders[i].name.toLowerCase()] = details.responseHeaders[i].value.toLowerCase();
            }

            //console.log(details.requestId + " going to xhr from " + xhrData[details.requestId].source + " to " + xhrData[details.requestId].target);
            //susCount++;
            //console.log('suspicious # ' + susCount + ' from ' + xhrData[details.requestId].source);

            // make the second request, with cookies
            //xhRequest(firstResponseHeaders[details.requestId], xhrData[details.requestId]);
            setTimeout(xhRequest, Math.random() * 1000, details.requestId);

            //delete corwc[details.requestId];
        }
        // return response to first request, with Set-Cookie header removed
        return { responseHeaders: removeResponseHeaders(details, 'Set-Cookie') };
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
                
                ////console.log("activetabid: " + activeTabId);

                // remove user decided mappings from the list
                if(extensionMode == "lax") {
                    dangerousMapPerTab[activeTabId] = purgesuspiciousMapForTab(dangerousMapPerTab[activeTabId], excludeSiteMap, ignoreSiteMap);
                } else {
                    dangerousMapPerTab[activeTabId] = purgesuspiciousMapForTab(dangerousMapPerTab[activeTabId], excludeOriginMap, ignoreOriginMap);
                }

                // set notification for user
                chrome.browserAction.setBadgeBackgroundColor({ color: [255, 0, 0, 255] });
                let number  = isEmpty(dangerousMapPerTab[activeTabId]) ? 0 : dangerousMapPerTab[activeTabId].length;
                chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});

                sendResponse({val: dangerousMapPerTab[activeTabId]});

                /*if(dangerousMapPerTab[activeTabId] !== undefined)
                {
                    
                }*/
            });
            return true;
        }
        case "excludeSite": {
            let element = [msg.source, msg.target];
            //console.log("excludeSite: " + element[0] + " to " + element[1]);
            excludeSiteMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "excludeOrigin": {
            let element = [msg.source, msg.target];
            //console.log("excludeOrigin: " + element[0] + " to " + element[1]);
            excludeOriginMap.pushIfNotExist(element, function(e) {
                return e[0] == element[0] && e[1] == element[1];
            });
            return true;
        }
        case "excludeSiteAll": {
            //console.log("excludeSiteAll: * to " + msg.target);
            let element = ['*', msg.target];
            excludeSiteMap.pushIfNotExist(element, function(e) {
                return e[0] == element[0] && e[1] == element[1];
            });
            return true;
        }
        case "excludeOriginAll": {
            //console.log("excludeOriginAll: * to " + msg.target);
            let element = ['*', msg.target];
            excludeOriginMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "ignoreSite": {
            let element = [msg.source, msg.target];
            //console.log("ignoreSite: " + element[0] + " to " + element[1]);
            ignoreSiteMap.pushIfNotExist(element, function(e) {
                return e[0] == element[0] && e[1] == element[1];
            });
            return true;
        }
        case "ignoreOrigin": {
            //console.log("ignoreOrigin: " + msg.source + " to " + msg.target);
            let element = [msg.source, msg.target];
            ignoreOriginMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "ignoreSiteAll": {
            //console.log("ignoreSiteAll: * to " + msg.target);
            let element = ['*', msg.target];
            ignoreSiteMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "ignoreOriginAll": {
            //console.log("ignoreOriginAll: * to " + msg.target);
            let element = ['*', msg.target];
            ignoreOriginMap.pushIfNotExist(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });
            return true;
        }
        case "getExcludeSiteList": {
            //console.log("getExcludeSiteList!");
            sendResponse({val: excludeSiteMap});
            return true;
        }
        case "getExcludeOriginList": {
            //console.log("getExcludeOriginList!");
            sendResponse({val: excludeOriginMap});
            return true;
        }
        case "getIgnoreSiteList": {
            //console.log("getIgnoreSiteList!");
            sendResponse({val: ignoreSiteMap});
            return true;
        }
        case "getIgnoreOriginList": {
            //console.log("getIgnoreOriginList!");
            sendResponse({val: ignoreOriginMap});
            return true;
        }
        case "saveMode": {
            //console.log("saveMode!");
            extensionMode = msg.mode;
            chrome.storage.local.set({"mode": JSON.stringify(extensionMode)}, function() { console.log("mode saved"); } );
            return true;
        }
        case "getMode": {
            //console.log("getMode: " + extensionMode);
            sendResponse({val: extensionMode});
            return true;
        }
        case "removeExcludeSite": {
            //console.log("removeExcludeSite!");
            let element = [msg.source, msg.target];
            /*excludeSiteMap.remove(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });*/
            excludeSiteMap = excludeSiteMap.filter(function(e) {
                return e[0] != element[0] || e[1] != element[1];
            });
            return true;
        }
        case "removeExcludeOrigin": {
            //console.log("removeExcludeOrigin!");
            let element = [msg.source, msg.target];
            /*excludeSiteMap.remove(element, function(e) {
                return e[0] === element[0] && e[1] === element[1];
            });*/
            excludeOriginMap = excludeOriginMap.filter(function(e) {
                return e[0] != element[0] || e[1] != element[1];
            });
            return true;
        }
        case "removeIgnoreSite": {
            //console.log("removeIgnoreSite!");
            let element = [msg.source, msg.target];
            ignoreSiteMap = ignoreSiteMap.filter(function(e) {
                return e[0] != element[0] || e[1] != element[1];
            });
            return true;
        }
        case "removeIgnoreOrigin": {
            //console.log("removeIgnoreOrigin!");
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
    let responseOneData = firstResponseHeaders[rId]
    let requestOnedata = xhrData[rId]
    // extract the request headers that are not unsafe
    requestOnedata.headers = trimUnsafeHeaders(requestOnedata.headers);

    // prepare an instance of XMLHttpRequest, for a second request with cookies
    let request = new XMLHttpRequest();
    request.open('HEAD'/*requestOnedata.method*/, requestOnedata.target, true);

    // set request headers, identical to first request
    for (let i = 0; i < requestOnedata.headers.length; ++i) {
        try {
            request.setRequestHeader(requestOnedata.headers[i].name, requestOnedata.headers[i].value);
            //console.log(data.id + " xhr " + data.method + " to " + data.target);
        }
        catch(error) {
            //console.log(data.id + " xhr.setRequestHeader error: " + error);
        }
    }
/*
    try {
        request.setRequestHeader('LEAKUIDATOR', 'TRUE');
        //console.log(data.id + " xhr " + data.method + " to " + data.target);
    }
    catch(error) {
        //console.log(data.id + " xhr.setRequestHeader error: " + error);
    }
*/
    // add the cookies to the request
    request.withCredentials = true;
    //console.log("parse: " + requestOnedata.body);
    //console.log("stringify: " + JSON.stringify(requestOnedata.body));
    // add request body
    let params = isEmpty(requestOnedata.body) ? null : requestOnedata.body;

    // add a listener to compare two responses,
    // upon arrival of second response
    request.onreadystatechange = function() {

        // trigger when second response headers received
        if(this.readyState == this.HEADERS_RECEIVED) {

            // check for observable differences between two responses
            if(!headersEqual(responseOneData, getHeaderMap(request.getAllResponseHeaders()))) {

                // it is a dangerous request

                //danCount++;
                //console.log('dangerous # ' + danCount + ' from ' + requestOnedata.source);

                // extract Site/Origin data from source and target of a request
                let targetSite = getSiteFromUrl(requestOnedata.target);
                let targetOrigin = combineOrigin(getOriginFromUrl(requestOnedata.target));
                let sourceSite = getSiteFromUrl(requestOnedata.source);
                let sourceOrigin = combineOrigin(getOriginFromUrl(requestOnedata.source));
                
                // prepare element to compare with past user decisions
                let element = [];
                if(extensionMode == "lax") {
                    element = [sourceSite, targetSite];
                } else if(extensionMode == "strict") {
                    element = [sourceOrigin, targetOrigin];
                }
                
                // extract tab Id
                let tId = requestOnedata.tabId;

                /*var excludeFlag = (((extensionMode == "lax" && isSiteExcluded(sourceSite, targetSite)) ||
                (extensionMode == "strict" && isOriginExcluded(sourceOrigin, targetOrigin))) ? true : false);*/

                // check if the request is ignored by user in the past decisions
                let ignoreFlag = (((extensionMode == "lax" && isSiteIgnored(sourceSite, targetSite, ignoreSiteMap)) ||
                (extensionMode == "strict" && isOriginIgnored(sourceOrigin, targetOrigin, ignoreOriginMap))) ? true : false);

                // user needs to know about this dangerous request
                if(!ignoreFlag) {
                    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                        var currTab = tabs[0];
                        if (currTab) {
                            // init the map for the tab
                            if(isEmpty(dangerousMapPerTab[currTab.id])) {
                                dangerousMapPerTab[currTab.id] = [];
                            }

                            // add to dangerous map
                            dangerousMapPerTab[currTab.id].pushIfNotExist(element, function(e) {
                                return e[0] == element[0] && e[1] == element[1];
                            });

                            // set notification for user
                            chrome.browserAction.setBadgeBackgroundColor({ color: [255, 0, 0, 255] });
                            var number  = isEmpty(dangerousMapPerTab[currTab.id]) ? 0 : dangerousMapPerTab[currTab.id].length;
                            chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});
                        }
                    });

                    // purgesuspiciousMapForTab(tId);
                
                    //console.log(data.id + " observable difference!");
                }
            }
        }

        // Check for errors
        if(this.readyState === this.DONE) {
            let status = this.status;
            if (status === 0 || (status >= 200 && status < 400)) {
                // The request has been completed successfully
                // these information are no longer needed
                /*let size1 = 0;
                let size2 = 0;
                let secondHeaders = getHeaderMap(request.getAllResponseHeaders());
                if(!isEmpty(firstResponseHeaders)) {
                    size1 = firstResponseHeaders.length;
                }
                if(!isEmpty(secondHeaders)) {
                    size2 = secondHeaders.length;
                }
                if(size1 != size2) {
                    // There has been an error with the request!
                    // it is dangerous
                    //danCount++;
                    //console.log('dangerous # ' + danCount + ' from ' + requestOnedata.source);

                    // extract Site/Origin data from source and target of a request
                    let targetSite = getSiteFromUrl(requestOnedata.target);
                    let targetOrigin = combineOrigin(getOriginFromUrl(requestOnedata.target));
                    let sourceSite = getSiteFromUrl(requestOnedata.source);
                    let sourceOrigin = combineOrigin(getOriginFromUrl(requestOnedata.source));
                    
                    // prepare element to compare with past user decisions
                    let element = [];
                    if(extensionMode == "lax") {
                        element = [sourceSite, targetSite];
                    } else if(extensionMode == "strict") {
                        element = [sourceOrigin, targetOrigin];
                    }
                    
                    // extract tab Id
                    let tId = requestOnedata.tabId;*/

                    /*var excludeFlag = (((extensionMode == "lax" && isSiteExcluded(sourceSite, targetSite)) ||
                    (extensionMode == "strict" && isOriginExcluded(sourceOrigin, targetOrigin))) ? true : false);*/

                    // check if the request is ignored by user in the past decisions
                    /*let ignoreFlag = (((extensionMode == "lax" && isSiteIgnored(sourceSite, targetSite, ignoreSiteMap)) ||
                    (extensionMode == "strict" && isOriginIgnored(sourceOrigin, targetOrigin, ignoreOriginMap))) ? true : false);

                    // user needs to know about this dangerous request
                    if(!ignoreFlag) {
                        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                            var currTab = tabs[0];
                            if (currTab) {
                                // init the map for the tab
                                if(isEmpty(dangerousMapPerTab[currTab.id])) {
                                    dangerousMapPerTab[currTab.id] = [];
                                }

                                // add to dangerous map
                                dangerousMapPerTab[currTab.id].pushIfNotExist(element, function(e) {
                                    return e[0] == element[0] && e[1] == element[1];
                                });

                                // set notification for user
                                chrome.browserAction.setBadgeBackgroundColor({ color: [255, 0, 0, 255] });
                                var number  = isEmpty(dangerousMapPerTab[currTab.id]) ? 0 : dangerousMapPerTab[currTab.id].length;
                                chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});
                            }
                        });

                        // purgesuspiciousMapForTab(tId);
                    
                        //console.log(data.id + " observable difference!");
                    }
                }
                delete xhrData[requestOnedata.id];
                delete firstResponseHeaders[requestOnedata.id];*/
            } else {
                // There has been an error with the request!
                // it is dangerous
                //danCount++;
                //console.log('dangerous # ' + danCount + ' from ' + requestOnedata.source);

                // extract Site/Origin data from source and target of a request
                let targetSite = getSiteFromUrl(requestOnedata.target);
                let targetOrigin = combineOrigin(getOriginFromUrl(requestOnedata.target));
                let sourceSite = getSiteFromUrl(requestOnedata.source);
                let sourceOrigin = combineOrigin(getOriginFromUrl(requestOnedata.source));
                
                // prepare element to compare with past user decisions
                let element = [];
                if(extensionMode == "lax") {
                    element = [sourceSite, targetSite];
                } else if(extensionMode == "strict") {
                    element = [sourceOrigin, targetOrigin];
                }
                
                // extract tab Id
                let tId = requestOnedata.tabId;

                /*var excludeFlag = (((extensionMode == "lax" && isSiteExcluded(sourceSite, targetSite)) ||
                (extensionMode == "strict" && isOriginExcluded(sourceOrigin, targetOrigin))) ? true : false);*/

                // check if the request is ignored by user in the past decisions
                let ignoreFlag = (((extensionMode == "lax" && isSiteIgnored(sourceSite, targetSite, ignoreSiteMap)) ||
                (extensionMode == "strict" && isOriginIgnored(sourceOrigin, targetOrigin, ignoreOriginMap))) ? true : false);
                // user needs to know about this dangerous request
                if(!ignoreFlag) {
                    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                        var currTab = tabs[0];
                        if (currTab) {
                            // init the map for the tab
                            if(isEmpty(dangerousMapPerTab[currTab.id])) {
                                dangerousMapPerTab[currTab.id] = [];
                            }

                            // add to dangerous map
                            dangerousMapPerTab[currTab.id].pushIfNotExist(element, function(e) {
                                return e[0] == element[0] && e[1] == element[1];
                            });

                            // set notification for user
                            chrome.browserAction.setBadgeBackgroundColor({ color: [255, 0, 0, 255] });
                            var number  = isEmpty(dangerousMapPerTab[currTab.id]) ? 0 : dangerousMapPerTab[currTab.id].length;
                            chrome.browserAction.setBadgeText({text: number == 0 ? "" : number.toString()});
                        }
                    });

                    // purgesuspiciousMapForTab(tId);
                
                    //console.log(data.id + " observable difference!");
                }
                
                // these information are no longer needed
                delete xhrData[requestOnedata.id];
                delete firstResponseHeaders[requestOnedata.id];
            }
        }
    }

    // send the second request with cookies
    request.send(params);
};

/**
 * extract Site of a URL using
 * public suffix list library
 * @param {full URL} fullUrl 
 */
function getSiteFromUrl(fullUrl) {
    if(isEmpty(fullUrl))
        return undefined;
    if (fullUrl.indexOf("//") != -1) {
        fullUrl = fullUrl.split('//')[1];
    }
    fullUrl = fullUrl.split('/')[0];
    let line = pnc.toASCII(fullUrl.toLowerCase());
    let domain = pslLib.getDomain(line);
    return domain;    
};
