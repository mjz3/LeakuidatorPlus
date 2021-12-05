(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
(function (global){
/*! https://mths.be/punycode v1.4.1 by @mathias */
;(function(root) {

	/** Detect free variables */
	var freeExports = typeof exports == 'object' && exports &&
		!exports.nodeType && exports;
	var freeModule = typeof module == 'object' && module &&
		!module.nodeType && module;
	var freeGlobal = typeof global == 'object' && global;
	if (
		freeGlobal.global === freeGlobal ||
		freeGlobal.window === freeGlobal ||
		freeGlobal.self === freeGlobal
	) {
		root = freeGlobal;
	}

	/**
	 * The `punycode` object.
	 * @name punycode
	 * @type Object
	 */
	var punycode,

	/** Highest positive signed 32-bit float value */
	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

	/** Bootstring parameters */
	base = 36,
	tMin = 1,
	tMax = 26,
	skew = 38,
	damp = 700,
	initialBias = 72,
	initialN = 128, // 0x80
	delimiter = '-', // '\x2D'

	/** Regular expressions */
	regexPunycode = /^xn--/,
	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

	/** Error messages */
	errors = {
		'overflow': 'Overflow: input needs wider integers to process',
		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
		'invalid-input': 'Invalid input'
	},

	/** Convenience shortcuts */
	baseMinusTMin = base - tMin,
	floor = Math.floor,
	stringFromCharCode = String.fromCharCode,

	/** Temporary variable */
	key;

	/*--------------------------------------------------------------------------*/

	/**
	 * A generic error utility function.
	 * @private
	 * @param {String} type The error type.
	 * @returns {Error} Throws a `RangeError` with the applicable error message.
	 */
	function error(type) {
		throw new RangeError(errors[type]);
	}

	/**
	 * A generic `Array#map` utility function.
	 * @private
	 * @param {Array} array The array to iterate over.
	 * @param {Function} callback The function that gets called for every array
	 * item.
	 * @returns {Array} A new array of values returned by the callback function.
	 */
	function map(array, fn) {
		var length = array.length;
		var result = [];
		while (length--) {
			result[length] = fn(array[length]);
		}
		return result;
	}

	/**
	 * A simple `Array#map`-like wrapper to work with domain name strings or email
	 * addresses.
	 * @private
	 * @param {String} domain The domain name or email address.
	 * @param {Function} callback The function that gets called for every
	 * character.
	 * @returns {Array} A new string of characters returned by the callback
	 * function.
	 */
	function mapDomain(string, fn) {
		var parts = string.split('@');
		var result = '';
		if (parts.length > 1) {
			// In email addresses, only the domain name should be punycoded. Leave
			// the local part (i.e. everything up to `@`) intact.
			result = parts[0] + '@';
			string = parts[1];
		}
		// Avoid `split(regex)` for IE8 compatibility. See #17.
		string = string.replace(regexSeparators, '\x2E');
		var labels = string.split('.');
		var encoded = map(labels, fn).join('.');
		return result + encoded;
	}

	/**
	 * Creates an array containing the numeric code points of each Unicode
	 * character in the string. While JavaScript uses UCS-2 internally,
	 * this function will convert a pair of surrogate halves (each of which
	 * UCS-2 exposes as separate characters) into a single code point,
	 * matching UTF-16.
	 * @see `punycode.ucs2.encode`
	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
	 * @memberOf punycode.ucs2
	 * @name decode
	 * @param {String} string The Unicode input string (UCS-2).
	 * @returns {Array} The new array of code points.
	 */
	function ucs2decode(string) {
		var output = [],
		    counter = 0,
		    length = string.length,
		    value,
		    extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	/**
	 * Creates a string based on an array of numeric code points.
	 * @see `punycode.ucs2.decode`
	 * @memberOf punycode.ucs2
	 * @name encode
	 * @param {Array} codePoints The array of numeric code points.
	 * @returns {String} The new Unicode string (UCS-2).
	 */
	function ucs2encode(array) {
		return map(array, function(value) {
			var output = '';
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
			return output;
		}).join('');
	}

	/**
	 * Converts a basic code point into a digit/integer.
	 * @see `digitToBasic()`
	 * @private
	 * @param {Number} codePoint The basic numeric code point value.
	 * @returns {Number} The numeric value of a basic code point (for use in
	 * representing integers) in the range `0` to `base - 1`, or `base` if
	 * the code point does not represent a value.
	 */
	function basicToDigit(codePoint) {
		if (codePoint - 48 < 10) {
			return codePoint - 22;
		}
		if (codePoint - 65 < 26) {
			return codePoint - 65;
		}
		if (codePoint - 97 < 26) {
			return codePoint - 97;
		}
		return base;
	}

	/**
	 * Converts a digit/integer into a basic code point.
	 * @see `basicToDigit()`
	 * @private
	 * @param {Number} digit The numeric value of a basic code point.
	 * @returns {Number} The basic code point whose value (when used for
	 * representing integers) is `digit`, which needs to be in the range
	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
	 * used; else, the lowercase form is used. The behavior is undefined
	 * if `flag` is non-zero and `digit` has no uppercase form.
	 */
	function digitToBasic(digit, flag) {
		//  0..25 map to ASCII a..z or A..Z
		// 26..35 map to ASCII 0..9
		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
	}

	/**
	 * Bias adaptation function as per section 3.4 of RFC 3492.
	 * https://tools.ietf.org/html/rfc3492#section-3.4
	 * @private
	 */
	function adapt(delta, numPoints, firstTime) {
		var k = 0;
		delta = firstTime ? floor(delta / damp) : delta >> 1;
		delta += floor(delta / numPoints);
		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
			delta = floor(delta / baseMinusTMin);
		}
		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
	}

	/**
	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
	 * symbols.
	 * @memberOf punycode
	 * @param {String} input The Punycode string of ASCII-only symbols.
	 * @returns {String} The resulting string of Unicode symbols.
	 */
	function decode(input) {
		// Don't use UCS-2
		var output = [],
		    inputLength = input.length,
		    out,
		    i = 0,
		    n = initialN,
		    bias = initialBias,
		    basic,
		    j,
		    index,
		    oldi,
		    w,
		    k,
		    digit,
		    t,
		    /** Cached calculation results */
		    baseMinusT;

		// Handle the basic code points: let `basic` be the number of input code
		// points before the last delimiter, or `0` if there is none, then copy
		// the first basic code points to the output.

		basic = input.lastIndexOf(delimiter);
		if (basic < 0) {
			basic = 0;
		}

		for (j = 0; j < basic; ++j) {
			// if it's not a basic code point
			if (input.charCodeAt(j) >= 0x80) {
				error('not-basic');
			}
			output.push(input.charCodeAt(j));
		}

		// Main decoding loop: start just after the last delimiter if any basic code
		// points were copied; start at the beginning otherwise.

		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

			// `index` is the index of the next character to be consumed.
			// Decode a generalized variable-length integer into `delta`,
			// which gets added to `i`. The overflow checking is easier
			// if we increase `i` as we go, then subtract off its starting
			// value at the end to obtain `delta`.
			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

				if (index >= inputLength) {
					error('invalid-input');
				}

				digit = basicToDigit(input.charCodeAt(index++));

				if (digit >= base || digit > floor((maxInt - i) / w)) {
					error('overflow');
				}

				i += digit * w;
				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

				if (digit < t) {
					break;
				}

				baseMinusT = base - t;
				if (w > floor(maxInt / baseMinusT)) {
					error('overflow');
				}

				w *= baseMinusT;

			}

			out = output.length + 1;
			bias = adapt(i - oldi, out, oldi == 0);

			// `i` was supposed to wrap around from `out` to `0`,
			// incrementing `n` each time, so we'll fix that now:
			if (floor(i / out) > maxInt - n) {
				error('overflow');
			}

			n += floor(i / out);
			i %= out;

			// Insert `n` at position `i` of the output
			output.splice(i++, 0, n);

		}

		return ucs2encode(output);
	}

	/**
	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
	 * Punycode string of ASCII-only symbols.
	 * @memberOf punycode
	 * @param {String} input The string of Unicode symbols.
	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
	 */
	function encode(input) {
		var n,
		    delta,
		    handledCPCount,
		    basicLength,
		    bias,
		    j,
		    m,
		    q,
		    k,
		    t,
		    currentValue,
		    output = [],
		    /** `inputLength` will hold the number of code points in `input`. */
		    inputLength,
		    /** Cached calculation results */
		    handledCPCountPlusOne,
		    baseMinusT,
		    qMinusT;

		// Convert the input in UCS-2 to Unicode
		input = ucs2decode(input);

		// Cache the length
		inputLength = input.length;

		// Initialize the state
		n = initialN;
		delta = 0;
		bias = initialBias;

		// Handle the basic code points
		for (j = 0; j < inputLength; ++j) {
			currentValue = input[j];
			if (currentValue < 0x80) {
				output.push(stringFromCharCode(currentValue));
			}
		}

		handledCPCount = basicLength = output.length;

		// `handledCPCount` is the number of code points that have been handled;
		// `basicLength` is the number of basic code points.

		// Finish the basic string - if it is not empty - with a delimiter
		if (basicLength) {
			output.push(delimiter);
		}

		// Main encoding loop:
		while (handledCPCount < inputLength) {

			// All non-basic code points < n have been handled already. Find the next
			// larger one:
			for (m = maxInt, j = 0; j < inputLength; ++j) {
				currentValue = input[j];
				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow
			handledCPCountPlusOne = handledCPCount + 1;
			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
				error('overflow');
			}

			delta += (m - n) * handledCPCountPlusOne;
			n = m;

			for (j = 0; j < inputLength; ++j) {
				currentValue = input[j];

				if (currentValue < n && ++delta > maxInt) {
					error('overflow');
				}

				if (currentValue == n) {
					// Represent delta as a generalized variable-length integer
					for (q = delta, k = base; /* no condition */; k += base) {
						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
						if (q < t) {
							break;
						}
						qMinusT = q - t;
						baseMinusT = base - t;
						output.push(
							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
						);
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}

			++delta;
			++n;

		}
		return output.join('');
	}

	/**
	 * Converts a Punycode string representing a domain name or an email address
	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
	 * it doesn't matter if you call it on a string that has already been
	 * converted to Unicode.
	 * @memberOf punycode
	 * @param {String} input The Punycoded domain name or email address to
	 * convert to Unicode.
	 * @returns {String} The Unicode representation of the given Punycode
	 * string.
	 */
	function toUnicode(input) {
		return mapDomain(input, function(string) {
			return regexPunycode.test(string)
				? decode(string.slice(4).toLowerCase())
				: string;
		});
	}

	/**
	 * Converts a Unicode string representing a domain name or an email address to
	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
	 * i.e. it doesn't matter if you call it with a domain that's already in
	 * ASCII.
	 * @memberOf punycode
	 * @param {String} input The domain name or email address to convert, as a
	 * Unicode string.
	 * @returns {String} The Punycode representation of the given domain name or
	 * email address.
	 */
	function toASCII(input) {
		return mapDomain(input, function(string) {
			return regexNonASCII.test(string)
				? 'xn--' + encode(string)
				: string;
		});
	}

	/*--------------------------------------------------------------------------*/

	/** Define the public API */
	punycode = {
		/**
		 * A string representing the current Punycode.js version number.
		 * @memberOf punycode
		 * @type String
		 */
		'version': '1.4.1',
		/**
		 * An object of methods to convert from JavaScript's internal character
		 * representation (UCS-2) to Unicode code points, and back.
		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
		 * @memberOf punycode
		 * @type Object
		 */
		'ucs2': {
			'decode': ucs2decode,
			'encode': ucs2encode
		},
		'decode': decode,
		'encode': encode,
		'toASCII': toASCII,
		'toUnicode': toUnicode
	};

	/** Expose `punycode` */
	// Some AMD build optimizers, like r.js, check for specific condition patterns
	// like the following:
	if (
		typeof define == 'function' &&
		typeof define.amd == 'object' &&
		define.amd
	) {
		define('punycode', function() {
			return punycode;
		});
	} else if (freeExports && freeModule) {
		if (module.exports == freeExports) {
			// in Node.js, io.js, or RingoJS v0.8.0+
			freeModule.exports = punycode;
		} else {
			// in Narwhal or RingoJS v0.7.0-
			for (key in punycode) {
				punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
			}
		}
	} else {
		// in Rhino or a web browser
		root.punycode = punycode;
	}

}(this));

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],3:[function(require,module,exports){
const suffixList = require('./publicsuffixlist');
const punycode = require('punycode'); 
const fs = require('fs');

getSuffixList = function (){
	return suffixList;
}

getPunycode = function (){
	return punycode;
}

getFS = function (){
	return fs;
}
},{"./publicsuffixlist":4,"fs":1,"punycode":2}],4:[function(require,module,exports){
/*******************************************************************************

    publicsuffixlist.js - an efficient javascript implementation to deal with
    Mozilla Foundation's Public Suffix List <http://publicsuffix.org/list/>

    Copyright (C) 2013-present Raymond Hill

    License: pick the one which suits you:
      GPL v3 see <https://www.gnu.org/licenses/gpl.html>
      APL v2 see <http://www.apache.org/licenses/LICENSE-2.0>

*/

/*! Home: https://github.com/gorhill/publicsuffixlist.js -- GPLv3 APLv2 */

/* jshint browser:true, esversion:6, laxbreak:true, undef:true, unused:true */
/* globals WebAssembly, console, exports:true, module */

/*******************************************************************************

    Reference:
    https://publicsuffix.org/list/

    Excerpt:

    > Algorithm
    > 
    > 1. Match domain against all rules and take note of the matching ones.
    > 2. If no rules match, the prevailing rule is "*".
    > 3. If more than one rule matches, the prevailing rule is the one which
         is an exception rule.
    > 4. If there is no matching exception rule, the prevailing rule is the
         one with the most labels.
    > 5. If the prevailing rule is a exception rule, modify it by removing
         the leftmost label.
    > 6. The public suffix is the set of labels from the domain which match
         the labels of the prevailing rule, using the matching algorithm above.
    > 7. The registered or registrable domain is the public suffix plus one
         additional label.

*/

/******************************************************************************/

(function(context) {
// >>>>>>>> start of anonymous namespace

'use strict';

/*******************************************************************************

    Tree encoding in array buffer:
    
     Node:
     +  u8: length of char data
     +  u8: flags => bit 0: is_publicsuffix, bit 1: is_exception
     + u16: length of array of children
     + u32: char data or offset to char data
     + u32: offset to array of children
     = 12 bytes

    More bits in flags could be used; for example:
    - to distinguish private suffixes

*/

                                    // i32 /  i8
const HOSTNAME_SLOT         = 0;    // jshint ignore:line
const LABEL_INDICES_SLOT    = 256;  //  -- / 256 (256/2 => 128 labels max)
const RULES_PTR_SLOT        = 100;  // 100 / 400 (400-256=144 => 144>128)
const SUFFIX_NOT_FOUND_SLOT = 399;  //  -- / 399 (safe, see above)
const CHARDATA_PTR_SLOT     = 101;  // 101 / 404
const EMPTY_STRING          = '';
const SELFIE_MAGIC          = 2;

let wasmMemory;
let pslBuffer32;
let pslBuffer8;
let pslByteLength = 0;
let hostnameArg = EMPTY_STRING;

/******************************************************************************/

const fireChangedEvent = function() {
    if (
        window instanceof Object &&
        window.dispatchEvent instanceof Function &&
        window.CustomEvent instanceof Function
    ) {
        window.dispatchEvent(new CustomEvent('publicSuffixListChanged'));
    }
};

/******************************************************************************/

const allocateBuffers = function(byteLength) {
    pslByteLength = byteLength + 3 & ~3;
    if (
        pslBuffer32 !== undefined &&
        pslBuffer32.byteLength >= pslByteLength
    ) {
        return;
    }
    if ( wasmMemory !== undefined ) {
        const newPageCount = pslByteLength + 0xFFFF >>> 16;
        const curPageCount = wasmMemory.buffer.byteLength >>> 16;
        const delta = newPageCount - curPageCount;
        if ( delta > 0 ) {
            wasmMemory.grow(delta);
            pslBuffer32 = new Uint32Array(wasmMemory.buffer);
            pslBuffer8 = new Uint8Array(wasmMemory.buffer);
        }
    } else {
        pslBuffer8 = new Uint8Array(pslByteLength);
        pslBuffer32 = new Uint32Array(pslBuffer8.buffer);
    }
    hostnameArg = EMPTY_STRING;
    pslBuffer8[LABEL_INDICES_SLOT] = 0;
};

/******************************************************************************/

// Parse and set a UTF-8 text-based suffix list. Format is same as found at:
// http://publicsuffix.org/list/
//
// `toAscii` is a converter from unicode to punycode. Required since the
// Public Suffix List contains unicode characters.
// Suggestion: use <https://github.com/bestiejs/punycode.js>

const parse = function(text, toAscii) {
    // Use short property names for better minifying results
    const rootRule = {
        l: EMPTY_STRING,    // l => label
        f: 0,               // f => flags
        c: undefined        // c => children
    };

    // Tree building
    {
        const compareLabels = function(a, b) {
            let n = a.length;
            let d = n - b.length;
            if ( d !== 0 ) { return d; }
            for ( let i = 0; i < n; i++ ) {
                d = a.charCodeAt(i) - b.charCodeAt(i);
                if ( d !== 0 ) { return d; }
            }
            return 0;
        };

        const addToTree = function(rule, exception) {
            let node = rootRule;
            let end = rule.length;
            while ( end > 0 ) {
                const beg = rule.lastIndexOf('.', end - 1);
                const label = rule.slice(beg + 1, end);
                end = beg;

                if ( Array.isArray(node.c) === false ) {
                    const child = { l: label, f: 0, c: undefined };
                    node.c = [ child ];
                    node = child;
                    continue;
                }

                let left = 0;
                let right = node.c.length;
                while ( left < right ) {
                    const i = left + right >>> 1;
                    const d = compareLabels(label, node.c[i].l);
                    if ( d < 0 ) {
                        right = i;
                        if ( right === left ) {
                            const child = {
                                l: label,
                                f: 0,
                                c: undefined
                            };
                            node.c.splice(left, 0, child);
                            node = child;
                            break;
                        }
                        continue;
                    }
                    if ( d > 0 ) {
                        left = i + 1;
                        if ( left === right ) {
                            const child = {
                                l: label,
                                f: 0,
                                c: undefined
                            };
                            node.c.splice(right, 0, child);
                            node = child;
                            break;
                        }
                        continue;
                    }
                    /* d === 0 */
                    node = node.c[i];
                    break;
                }
            }
            node.f |= 0b01;
            if ( exception ) {
                node.f |= 0b10;
            }
        };

        // 2. If no rules match, the prevailing rule is "*".
        addToTree('*', false);

        const mustPunycode = /[^a-z0-9.-]/;
        const textEnd = text.length;
        let lineBeg = 0;

        while ( lineBeg < textEnd ) {
            let lineEnd = text.indexOf('\n', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = text.indexOf('\r', lineBeg);
                if ( lineEnd === -1 ) {
                    lineEnd = textEnd;
                }
            }
            let line = text.slice(lineBeg, lineEnd).trim();
            lineBeg = lineEnd + 1;

            // Ignore comments
            const pos = line.indexOf('//');
            if ( pos !== -1 ) {
                line = line.slice(0, pos);
            }

            // Ignore surrounding whitespaces
            line = line.trim();
            if ( line.length === 0 ) { continue; }

            const exception = line.charCodeAt(0) === 0x21 /* '!' */;
            if ( exception ) {
                line = line.slice(1);
            }

            if ( mustPunycode.test(line) ) {
                line = toAscii(line.toLowerCase());
            }

            addToTree(line, exception);
        }
    }

    {
        const labelToOffsetMap = new Map();
        const treeData = [];
        const charData = [];

        const allocate = function(n) {
            const ibuf = treeData.length;
            for ( let i = 0; i < n; i++ ) {
                treeData.push(0);
            }
            return ibuf;
        };

        const storeNode = function(ibuf, node) {
            const nChars = node.l.length;
            const nChildren = node.c !== undefined
                ? node.c.length
                : 0;
            treeData[ibuf+0] = nChildren << 16 | node.f << 8 | nChars;
            // char data
            if ( nChars <= 4 ) {
                let v = 0;
                if ( nChars > 0 ) {
                    v |= node.l.charCodeAt(0);
                    if ( nChars > 1 ) {
                        v |= node.l.charCodeAt(1) << 8;
                        if ( nChars > 2 ) {
                            v |= node.l.charCodeAt(2) << 16;
                            if ( nChars > 3 ) {
                                v |= node.l.charCodeAt(3) << 24;
                            }
                        }
                    }
                }
                treeData[ibuf+1] = v;
            } else {
                let offset = labelToOffsetMap.get(node.l);
                if ( offset === undefined ) {
                    offset = charData.length;
                    for ( let i = 0; i < nChars; i++ ) {
                        charData.push(node.l.charCodeAt(i));
                    }
                    labelToOffsetMap.set(node.l, offset);
                }
                treeData[ibuf+1] = offset;
            }
            // child nodes
            if ( Array.isArray(node.c) === false ) {
                treeData[ibuf+2] = 0;
                return;
            }
            
            const iarray = allocate(nChildren * 3);
            treeData[ibuf+2] = iarray;
            for ( let i = 0; i < nChildren; i++ ) {
                storeNode(iarray + i * 3, node.c[i]);
            }
        };

        // First 512 bytes are reserved for internal use
        allocate(512 >> 2);

        const iRootRule = allocate(3);
        storeNode(iRootRule, rootRule);
        treeData[RULES_PTR_SLOT] = iRootRule;

        const iCharData = treeData.length << 2;
        treeData[CHARDATA_PTR_SLOT] = iCharData;

        const byteLength = (treeData.length << 2) + (charData.length + 3 & ~3);
        allocateBuffers(byteLength);
        pslBuffer32.set(treeData);
        pslBuffer8.set(charData, treeData.length << 2);
    }

    fireChangedEvent();
};

/******************************************************************************/

const setHostnameArg = function(hostname) {
    const buf = pslBuffer8;
    if ( hostname === hostnameArg ) { return buf[LABEL_INDICES_SLOT]; }
    if ( hostname === null || hostname.length === 0 ) {
        hostnameArg = EMPTY_STRING;
        return (buf[LABEL_INDICES_SLOT] = 0);
    }
    hostname = hostname.toLowerCase();
    hostnameArg = hostname;
    let n = hostname.length;
    if ( n > 255 ) { n = 255; }
    buf[LABEL_INDICES_SLOT] = n;
    let i = n;
    let j = LABEL_INDICES_SLOT + 1;
    while ( i-- ) {
        const c = hostname.charCodeAt(i);
        if ( c === 0x2E /* '.' */ ) {
            buf[j+0] = i + 1;
            buf[j+1] = i;
            j += 2;
        }
        buf[i] = c;
    }
    buf[j] = 0;
    return n;
};

/******************************************************************************/

// Returns an offset to the start of the public suffix.
//
// WASM-able, because no information outside the buffer content is required.

const getPublicSuffixPosJS = function() {
    const buf8 = pslBuffer8;
    const buf32 = pslBuffer32;
    const iCharData = buf32[CHARDATA_PTR_SLOT];

    let iNode = pslBuffer32[RULES_PTR_SLOT];
    let cursorPos = -1;
    let iLabel = LABEL_INDICES_SLOT;

    // Label-lookup loop
    for (;;) {
        // Extract label indices
        const labelBeg = buf8[iLabel+1];
        const labelLen = buf8[iLabel+0] - labelBeg;
        // Match-lookup loop: binary search
        let r = buf32[iNode+0] >>> 16;
        if ( r === 0 ) { break; }
        const iCandidates = buf32[iNode+2];
        let l = 0;
        let iFound = 0;
        while ( l < r ) {
            const iCandidate = l + r >>> 1;
            const iCandidateNode = iCandidates + iCandidate + (iCandidate << 1);
            const candidateLen = buf32[iCandidateNode+0] & 0x000000FF;
            let d = labelLen - candidateLen;
            if ( d === 0 ) {
                const iCandidateChar = candidateLen <= 4
                    ? iCandidateNode + 1 << 2
                    : iCharData + buf32[iCandidateNode+1];
                for ( let i = 0; i < labelLen; i++ ) {
                    d = buf8[labelBeg+i] - buf8[iCandidateChar+i];
                    if ( d !== 0 ) { break; }
                }
            }
            if ( d < 0 ) {
                r = iCandidate;
            } else if ( d > 0 ) {
                l = iCandidate + 1;
            } else /* if ( d === 0 ) */ {
                iFound = iCandidateNode;
                break;
            }
        }
        // 2. If no rules match, the prevailing rule is "*".
        if ( iFound === 0 ) {
            if ( buf8[iCandidates + 1 << 2] !== 0x2A /* '*' */ ) { break; }
            buf8[SUFFIX_NOT_FOUND_SLOT] = 1;
            iFound = iCandidates;
        }
        iNode = iFound;
        // 5. If the prevailing rule is a exception rule, modify it by
        //    removing the leftmost label.
        if ( (buf32[iNode+0] & 0x00000200) !== 0 ) {
            if ( iLabel > LABEL_INDICES_SLOT ) {
                return iLabel - 2;
            }
            break;
        }
        if ( (buf32[iNode+0] & 0x00000100) !== 0 ) {
            cursorPos = iLabel;
        }
        if ( labelBeg === 0 ) { break; }
        iLabel += 2;
    }

    return cursorPos;
};

let getPublicSuffixPosWASM;
let getPublicSuffixPos = getPublicSuffixPosJS;

/******************************************************************************/

const getPublicSuffix = function(hostname) {
    if ( pslBuffer32 === undefined ) { return EMPTY_STRING; }

    const hostnameLen = setHostnameArg(hostname);
    const buf8 = pslBuffer8;
    if ( hostnameLen === 0 || buf8[0] === 0x2E /* '.' */ ) {
        return EMPTY_STRING;
    }

    const cursorPos = getPublicSuffixPos();
    if ( cursorPos === -1 ) {
        return EMPTY_STRING;
    }

    const beg = buf8[cursorPos + 1];
    return beg === 0 ? hostnameArg : hostnameArg.slice(beg);
};

/******************************************************************************/

const getDomain = function(hostname) {
    if ( pslBuffer32 === undefined ) { return EMPTY_STRING; }

    const hostnameLen = setHostnameArg(hostname);
    const buf8 = pslBuffer8;
    if ( hostnameLen === 0 || buf8[0] === 0x2E /* '.' */ ) {
        return EMPTY_STRING;
    }

    const cursorPos = getPublicSuffixPos();
    if ( cursorPos === -1 || buf8[cursorPos + 1] === 0 ) {
        return EMPTY_STRING;
    }

    // 7. The registered or registrable domain is the public suffix plus one
    //    additional label.
    const beg = buf8[cursorPos + 3];
    return beg === 0 ? hostnameArg : hostnameArg.slice(beg);
};

/******************************************************************************/

const suffixInPSL = function(hostname) {
    if ( pslBuffer32 === undefined ) { return false; }

    const hostnameLen = setHostnameArg(hostname);
    const buf8 = pslBuffer8;
    if ( hostnameLen === 0 || buf8[0] === 0x2E /* '.' */ ) {
        return false;
    }

    buf8[SUFFIX_NOT_FOUND_SLOT] = 0;
    const cursorPos = getPublicSuffixPos();
    return cursorPos !== -1 &&
           buf8[cursorPos + 1] === 0 &&
           buf8[SUFFIX_NOT_FOUND_SLOT] !== 1;
};

/******************************************************************************/

const toSelfie = function(encoder) {
    if ( pslBuffer8 === undefined ) { return ''; }
    if ( encoder instanceof Object ) {
        const bufferStr = encoder.encode(pslBuffer8.buffer, pslByteLength);
        return `${SELFIE_MAGIC}\t${bufferStr}`;
    }
    return {
        magic: SELFIE_MAGIC,
        buf32: Array.from(
            new Uint32Array(pslBuffer8.buffer, 0, pslByteLength >>> 2)
        ),
    };
};

const fromSelfie = function(selfie, decoder) {
    let byteLength = 0;
    if (
        typeof selfie === 'string' &&
        selfie.length !== 0 &&
        decoder instanceof Object
    ) {
        const pos = selfie.indexOf('\t');
        if ( pos === -1 || selfie.slice(0, pos) !== `${SELFIE_MAGIC}` ) {
            return false;
        }
        const bufferStr = selfie.slice(pos + 1);
        byteLength = decoder.decodeSize(bufferStr);
        if ( byteLength === 0 ) { return false; }
        allocateBuffers(byteLength);
        decoder.decode(bufferStr, pslBuffer8.buffer);
    } else if (
        selfie instanceof Object &&
        selfie.magic === SELFIE_MAGIC &&
        Array.isArray(selfie.buf32)
    ) {
        byteLength = selfie.buf32.length << 2;
        allocateBuffers(byteLength);
        pslBuffer32.set(selfie.buf32);
    } else {
        return false;
    }

    // Important!
    hostnameArg = EMPTY_STRING;
    pslBuffer8[LABEL_INDICES_SLOT] = 0;

    fireChangedEvent();

    return true;
};

/******************************************************************************/

// The WASM module is entirely optional, the JS implementation will be
// used should the WASM module be unavailable for whatever reason.

const enableWASM = (function() {
    // The directory from which the current script was fetched should also
    // contain the related WASM file. The script is fetched from a trusted
    // location, and consequently so will be the related WASM file.
    let workingDir;
    {
        const url = new URL(document.currentScript.src);
        const match = /[^\/]+$/.exec(url.pathname);
        if ( match !== null ) {
            url.pathname = url.pathname.slice(0, match.index);
        }
        workingDir = url.href;
    }

    let memory;

    return function() {
        if ( getPublicSuffixPosWASM instanceof Function ) {
            return Promise.resolve(true);
        }

        if (
            typeof WebAssembly !== 'object' ||
            typeof WebAssembly.instantiateStreaming !== 'function'
        ) {
            return Promise.resolve(false);
        }

        // The wasm code will work only if CPU is natively little-endian,
        // as we use native uint32 array in our js code.
        const uint32s = new Uint32Array(1);
        const uint8s = new Uint8Array(uint32s.buffer);
        uint32s[0] = 1;
        if ( uint8s[0] !== 1 ) {
            return Promise.resolve(false);
        }

        return fetch(
            workingDir + 'wasm/publicsuffixlist.wasm',
            { mode: 'same-origin' }
        ).then(response => {
            const pageCount = pslBuffer8 !== undefined
                ? pslBuffer8.byteLength + 0xFFFF >>> 16
                : 1;
            memory = new WebAssembly.Memory({ initial: pageCount });
            return WebAssembly.instantiateStreaming(
                response,
                { imports: { memory: memory } }
            );
        }).then(({ instance }) => {
            const curPageCount = memory.buffer.byteLength >>> 16;
            const newPageCount = pslBuffer8 !== undefined
                ? pslBuffer8.byteLength + 0xFFFF >>> 16
                : 0;
            if ( newPageCount > curPageCount ) {
                memory.grow(newPageCount - curPageCount);
            }
            if ( pslBuffer32 !== undefined ) {
                const buf8 = new Uint8Array(memory.buffer);
                const buf32 = new Uint32Array(memory.buffer);
                buf32.set(pslBuffer32);
                pslBuffer8 = buf8;
                pslBuffer32 = buf32;
            }
            wasmMemory = memory;
            getPublicSuffixPosWASM = instance.exports.getPublicSuffixPos;
            getPublicSuffixPos = getPublicSuffixPosWASM;
            memory = undefined;
            return true;
        }).catch(reason => {
            console.info(reason);
            return false;
        });
    };
})();

const disableWASM = function() {
    if ( getPublicSuffixPosWASM instanceof Function ) {
        getPublicSuffixPos = getPublicSuffixPosJS;
        getPublicSuffixPosWASM = undefined;
    }
    if ( wasmMemory === undefined ) { return; }
    if ( pslBuffer32 !== undefined ) {
        const buf8 = new Uint8Array(pslByteLength);
        const buf32 = new Uint32Array(buf8.buffer);
        buf32.set(pslBuffer32);
        pslBuffer8 = buf8;
        pslBuffer32 = buf32;
    }
    wasmMemory = undefined;
};

/******************************************************************************/

context = context || window;

context.publicSuffixList = {
    version: '2.0',
    parse,
    getDomain,
    getPublicSuffix,
    suffixInPSL,
    toSelfie, fromSelfie,
    disableWASM, enableWASM,
};

if ( typeof module !== 'undefined' ) { 
    module.exports = context.publicSuffixList;
} else if ( typeof exports !== 'undefined' ) {
    exports = context.publicSuffixList;
}

/******************************************************************************/

// <<<<<<<< end of anonymous namespace
})(this);

},{}]},{},[3]);
