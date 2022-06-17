
"use strict";
var extMode = "Relaxed";

// Get the list on current tab as soon as the document's DOM is ready.
document.addEventListener('DOMContentLoaded', function () {
    chrome.runtime.sendMessage({type: "getMode"}, function(response) {
        if(response != undefined) {
            extMode = response.val;
        }
    })
    chrome.runtime.sendMessage({type: "getSuspiciousList"}, function(response) {
        if(response != undefined) {
            if(response.val != undefined) {
                createHtmlForSuspiciousList(response.val);
            }
        }
    });
    
    var optbutton = document.getElementById("options-button");
    optbutton.addEventListener("click", function () {
        chrome.tabs.query({url: chrome.runtime.getURL('') + '*'}, tabs => {
            if (!tabs[0]) {
              chrome.runtime.openOptionsPage();
              window.close();
              return;
            }
            const tab = tabs.find(item => /ext\/options\.html/.test(item.url));  // find an option tab
            tab ? chrome.tabs.update(tab.id, {active: true}) : chrome.tabs.update(tabs[0].id, {active: true, url: '/ext/options.html'});
            window.close();
          });
    });
});

function createHtmlForSuspiciousList(suspiciousMap) {
	if (suspiciousMap == undefined) {
		setHtmlForSuspiciousList("<b>No suspicious requests here! :)</b>");
        return;
    } else {
        var html = "<b>suspicious requests on current page:</b>";
        recursivelyBuildHtmlForSuspiciousList(html, 0, suspiciousMap);
    }
}
 
function recursivelyBuildHtmlForSuspiciousList(html, index, suspiciousMap) {
    if (suspiciousMap.length == index) {
        setHtmlForSuspiciousList(html, suspiciousMap);
        return;
    }
    
    if(suspiciousMap[index] != undefined) {
        let src = suspiciousMap[index][0];
        var trgt = suspiciousMap[index][1];
        let idx = src + '_' + trgt;

        html += "<br>" + "<b>source:</b> " + src + "<br><b>target:</b> " + trgt + "<br>" +
            getExcludeButton(idx) + " " + getExcludeAllButton(idx) + getIgnoreButton(idx) + " " + getIgnoreAllButton(idx) + "<br>";
        
        recursivelyBuildHtmlForSuspiciousList(html, index+1, suspiciousMap);
    }
    return;
}

function getExcludeButton(idx) {
    return "[<a class='exclude' id='" + idx + "_exclude" + "' href='#'>exclude pair</a>] ";
}

function getExcludeAllButton(idx) {
    return "[<a class='excludeAll' id='" + idx + "_excludeAll" + "' href='#'>exclude target</a>] ";
}

function getIgnoreButton(idx) {
    return "[<a class='ignore' id='" + idx + "_ignore" + "' href='#'>ignore pair</a>] ";
}

function getIgnoreAllButton(idx) {
    return "[<a class='ignoreAll' id='" + idx + "_ignoreAll" + "' href='#'>ignore target</a>] ";
}

function setHtmlForSuspiciousList(html, suspiciousMap) {
    let bodyDiv = document.getElementById("bodyDiv");
    bodyDiv.innerHTML  = html;
    // Set up listeners for block/unblock links
    for(let i = 0; i < suspiciousMap.length; ++i) {
        let suspicious = suspiciousMap[i];
        let src = suspicious[0];
        let trgt = suspicious[1];
        let idx = src + '_' + trgt;
        let link = document.getElementById(idx+"_exclude");
        
            link.addEventListener('click', function() {
                if(extMode == "Relaxed") {
                    chrome.runtime.sendMessage({type: 'excludeSite', source: src, target: trgt}, null);
                } else {
                    chrome.runtime.sendMessage({type: 'excludeOrigin', source: src, target: trgt}, null);
                }
                this.style.color='blue';
                location.reload(true);
            });

        link = document.getElementById(idx+"_excludeAll");

            link.addEventListener('click', function() {
                if(extMode == "Relaxed") {
                    chrome.runtime.sendMessage({type: 'excludeSiteAll', target: trgt}, null);
                } else {
                    chrome.runtime.sendMessage({type: 'excludeOriginAll', target: trgt}, null);
                }
                this.style.color='blue';
                location.reload(true);
            });

        link = document.getElementById(idx+"_ignore");
            link.addEventListener('click', function() {
                if(extMode == "Relaxed") {
                    chrome.runtime.sendMessage({type: 'ignoreSite', source: src, target: trgt}, null);
                } else {
                    chrome.runtime.sendMessage({type: 'ignoreOrigin', source: src, target: trgt}, null);
                }
                this.style.color='blue';
                location.reload(true);
            });

        link = document.getElementById(idx+"_ignoreAll");
        
            link.addEventListener('click', function() {
                if(extMode == "Relaxed") {
                    chrome.runtime.sendMessage({type: 'ignoreSiteAll', target: trgt}, null);
                } else {
                    chrome.runtime.sendMessage({type: 'ignoreOriginAll', target: trgt}, null);
                }
                this.style.color='blue';
                location.reload(true);
            });
    }
}
