(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/postcss-value-parser/lib/parse.js
  var require_parse = __commonJS({
    "node_modules/postcss-value-parser/lib/parse.js"(exports, module) {
      var openParentheses = "(".charCodeAt(0);
      var closeParentheses = ")".charCodeAt(0);
      var singleQuote = "'".charCodeAt(0);
      var doubleQuote = '"'.charCodeAt(0);
      var backslash = "\\".charCodeAt(0);
      var slash = "/".charCodeAt(0);
      var comma = ",".charCodeAt(0);
      var colon = ":".charCodeAt(0);
      var star = "*".charCodeAt(0);
      var uLower = "u".charCodeAt(0);
      var uUpper = "U".charCodeAt(0);
      var plus = "+".charCodeAt(0);
      var isUnicodeRange = /^[a-f0-9?-]+$/i;
      module.exports = function(input) {
        var tokens = [];
        var value = input;
        var next, quote, prev, token, escape, escapePos, whitespacePos, parenthesesOpenPos;
        var pos = 0;
        var code = value.charCodeAt(pos);
        var max = value.length;
        var stack = [{ nodes: tokens }];
        var balanced = 0;
        var parent;
        var name = "";
        var before = "";
        var after = "";
        while (pos < max) {
          if (code <= 32) {
            next = pos;
            do {
              next += 1;
              code = value.charCodeAt(next);
            } while (code <= 32);
            token = value.slice(pos, next);
            prev = tokens[tokens.length - 1];
            if (code === closeParentheses && balanced) {
              after = token;
            } else if (prev && prev.type === "div") {
              prev.after = token;
              prev.sourceEndIndex += token.length;
            } else if (code === comma || code === colon || code === slash && value.charCodeAt(next + 1) !== star && (!parent || parent && parent.type === "function" && parent.value !== "calc")) {
              before = token;
            } else {
              tokens.push({
                type: "space",
                sourceIndex: pos,
                sourceEndIndex: next,
                value: token
              });
            }
            pos = next;
          } else if (code === singleQuote || code === doubleQuote) {
            next = pos;
            quote = code === singleQuote ? "'" : '"';
            token = {
              type: "string",
              sourceIndex: pos,
              quote
            };
            do {
              escape = false;
              next = value.indexOf(quote, next + 1);
              if (~next) {
                escapePos = next;
                while (value.charCodeAt(escapePos - 1) === backslash) {
                  escapePos -= 1;
                  escape = !escape;
                }
              } else {
                value += quote;
                next = value.length - 1;
                token.unclosed = true;
              }
            } while (escape);
            token.value = value.slice(pos + 1, next);
            token.sourceEndIndex = token.unclosed ? next : next + 1;
            tokens.push(token);
            pos = next + 1;
            code = value.charCodeAt(pos);
          } else if (code === slash && value.charCodeAt(pos + 1) === star) {
            next = value.indexOf("*/", pos);
            token = {
              type: "comment",
              sourceIndex: pos,
              sourceEndIndex: next + 2
            };
            if (next === -1) {
              token.unclosed = true;
              next = value.length;
              token.sourceEndIndex = next;
            }
            token.value = value.slice(pos + 2, next);
            tokens.push(token);
            pos = next + 2;
            code = value.charCodeAt(pos);
          } else if ((code === slash || code === star) && parent && parent.type === "function" && parent.value === "calc") {
            token = value[pos];
            tokens.push({
              type: "word",
              sourceIndex: pos - before.length,
              sourceEndIndex: pos + token.length,
              value: token
            });
            pos += 1;
            code = value.charCodeAt(pos);
          } else if (code === slash || code === comma || code === colon) {
            token = value[pos];
            tokens.push({
              type: "div",
              sourceIndex: pos - before.length,
              sourceEndIndex: pos + token.length,
              value: token,
              before,
              after: ""
            });
            before = "";
            pos += 1;
            code = value.charCodeAt(pos);
          } else if (openParentheses === code) {
            next = pos;
            do {
              next += 1;
              code = value.charCodeAt(next);
            } while (code <= 32);
            parenthesesOpenPos = pos;
            token = {
              type: "function",
              sourceIndex: pos - name.length,
              value: name,
              before: value.slice(parenthesesOpenPos + 1, next)
            };
            pos = next;
            if (name === "url" && code !== singleQuote && code !== doubleQuote) {
              next -= 1;
              do {
                escape = false;
                next = value.indexOf(")", next + 1);
                if (~next) {
                  escapePos = next;
                  while (value.charCodeAt(escapePos - 1) === backslash) {
                    escapePos -= 1;
                    escape = !escape;
                  }
                } else {
                  value += ")";
                  next = value.length - 1;
                  token.unclosed = true;
                }
              } while (escape);
              whitespacePos = next;
              do {
                whitespacePos -= 1;
                code = value.charCodeAt(whitespacePos);
              } while (code <= 32);
              if (parenthesesOpenPos < whitespacePos) {
                if (pos !== whitespacePos + 1) {
                  token.nodes = [
                    {
                      type: "word",
                      sourceIndex: pos,
                      sourceEndIndex: whitespacePos + 1,
                      value: value.slice(pos, whitespacePos + 1)
                    }
                  ];
                } else {
                  token.nodes = [];
                }
                if (token.unclosed && whitespacePos + 1 !== next) {
                  token.after = "";
                  token.nodes.push({
                    type: "space",
                    sourceIndex: whitespacePos + 1,
                    sourceEndIndex: next,
                    value: value.slice(whitespacePos + 1, next)
                  });
                } else {
                  token.after = value.slice(whitespacePos + 1, next);
                  token.sourceEndIndex = next;
                }
              } else {
                token.after = "";
                token.nodes = [];
              }
              pos = next + 1;
              token.sourceEndIndex = token.unclosed ? next : pos;
              code = value.charCodeAt(pos);
              tokens.push(token);
            } else {
              balanced += 1;
              token.after = "";
              token.sourceEndIndex = pos + 1;
              tokens.push(token);
              stack.push(token);
              tokens = token.nodes = [];
              parent = token;
            }
            name = "";
          } else if (closeParentheses === code && balanced) {
            pos += 1;
            code = value.charCodeAt(pos);
            parent.after = after;
            parent.sourceEndIndex += after.length;
            after = "";
            balanced -= 1;
            stack[stack.length - 1].sourceEndIndex = pos;
            stack.pop();
            parent = stack[balanced];
            tokens = parent.nodes;
          } else {
            next = pos;
            do {
              if (code === backslash) {
                next += 1;
              }
              next += 1;
              code = value.charCodeAt(next);
            } while (next < max && !(code <= 32 || code === singleQuote || code === doubleQuote || code === comma || code === colon || code === slash || code === openParentheses || code === star && parent && parent.type === "function" && parent.value === "calc" || code === slash && parent.type === "function" && parent.value === "calc" || code === closeParentheses && balanced));
            token = value.slice(pos, next);
            if (openParentheses === code) {
              name = token;
            } else if ((uLower === token.charCodeAt(0) || uUpper === token.charCodeAt(0)) && plus === token.charCodeAt(1) && isUnicodeRange.test(token.slice(2))) {
              tokens.push({
                type: "unicode-range",
                sourceIndex: pos,
                sourceEndIndex: next,
                value: token
              });
            } else {
              tokens.push({
                type: "word",
                sourceIndex: pos,
                sourceEndIndex: next,
                value: token
              });
            }
            pos = next;
          }
        }
        for (pos = stack.length - 1; pos; pos -= 1) {
          stack[pos].unclosed = true;
          stack[pos].sourceEndIndex = value.length;
        }
        return stack[0].nodes;
      };
    }
  });

  // node_modules/postcss-value-parser/lib/walk.js
  var require_walk = __commonJS({
    "node_modules/postcss-value-parser/lib/walk.js"(exports, module) {
      module.exports = function walk(nodes, cb, bubble) {
        var i, max, node, result;
        for (i = 0, max = nodes.length; i < max; i += 1) {
          node = nodes[i];
          if (!bubble) {
            result = cb(node, i, nodes);
          }
          if (result !== false && node.type === "function" && Array.isArray(node.nodes)) {
            walk(node.nodes, cb, bubble);
          }
          if (bubble) {
            cb(node, i, nodes);
          }
        }
      };
    }
  });

  // node_modules/postcss-value-parser/lib/stringify.js
  var require_stringify = __commonJS({
    "node_modules/postcss-value-parser/lib/stringify.js"(exports, module) {
      function stringifyNode(node, custom) {
        var type = node.type;
        var value = node.value;
        var buf;
        var customResult;
        if (custom && (customResult = custom(node)) !== void 0) {
          return customResult;
        } else if (type === "word" || type === "space") {
          return value;
        } else if (type === "string") {
          buf = node.quote || "";
          return buf + value + (node.unclosed ? "" : buf);
        } else if (type === "comment") {
          return "/*" + value + (node.unclosed ? "" : "*/");
        } else if (type === "div") {
          return (node.before || "") + value + (node.after || "");
        } else if (Array.isArray(node.nodes)) {
          buf = stringify(node.nodes, custom);
          if (type !== "function") {
            return buf;
          }
          return value + "(" + (node.before || "") + buf + (node.after || "") + (node.unclosed ? "" : ")");
        }
        return value;
      }
      function stringify(nodes, custom) {
        var result, i;
        if (Array.isArray(nodes)) {
          result = "";
          for (i = nodes.length - 1; ~i; i -= 1) {
            result = stringifyNode(nodes[i], custom) + result;
          }
          return result;
        }
        return stringifyNode(nodes, custom);
      }
      module.exports = stringify;
    }
  });

  // node_modules/postcss-value-parser/lib/unit.js
  var require_unit = __commonJS({
    "node_modules/postcss-value-parser/lib/unit.js"(exports, module) {
      var minus = "-".charCodeAt(0);
      var plus = "+".charCodeAt(0);
      var dot = ".".charCodeAt(0);
      var exp = "e".charCodeAt(0);
      var EXP = "E".charCodeAt(0);
      function likeNumber(value) {
        var code = value.charCodeAt(0);
        var nextCode;
        if (code === plus || code === minus) {
          nextCode = value.charCodeAt(1);
          if (nextCode >= 48 && nextCode <= 57) {
            return true;
          }
          var nextNextCode = value.charCodeAt(2);
          if (nextCode === dot && nextNextCode >= 48 && nextNextCode <= 57) {
            return true;
          }
          return false;
        }
        if (code === dot) {
          nextCode = value.charCodeAt(1);
          if (nextCode >= 48 && nextCode <= 57) {
            return true;
          }
          return false;
        }
        if (code >= 48 && code <= 57) {
          return true;
        }
        return false;
      }
      module.exports = function(value) {
        var pos = 0;
        var length = value.length;
        var code;
        var nextCode;
        var nextNextCode;
        if (length === 0 || !likeNumber(value)) {
          return false;
        }
        code = value.charCodeAt(pos);
        if (code === plus || code === minus) {
          pos++;
        }
        while (pos < length) {
          code = value.charCodeAt(pos);
          if (code < 48 || code > 57) {
            break;
          }
          pos += 1;
        }
        code = value.charCodeAt(pos);
        nextCode = value.charCodeAt(pos + 1);
        if (code === dot && nextCode >= 48 && nextCode <= 57) {
          pos += 2;
          while (pos < length) {
            code = value.charCodeAt(pos);
            if (code < 48 || code > 57) {
              break;
            }
            pos += 1;
          }
        }
        code = value.charCodeAt(pos);
        nextCode = value.charCodeAt(pos + 1);
        nextNextCode = value.charCodeAt(pos + 2);
        if ((code === exp || code === EXP) && (nextCode >= 48 && nextCode <= 57 || (nextCode === plus || nextCode === minus) && nextNextCode >= 48 && nextNextCode <= 57)) {
          pos += nextCode === plus || nextCode === minus ? 3 : 2;
          while (pos < length) {
            code = value.charCodeAt(pos);
            if (code < 48 || code > 57) {
              break;
            }
            pos += 1;
          }
        }
        return {
          number: value.slice(0, pos),
          unit: value.slice(pos)
        };
      };
    }
  });

  // node_modules/postcss-value-parser/lib/index.js
  var require_lib = __commonJS({
    "node_modules/postcss-value-parser/lib/index.js"(exports, module) {
      var parse = require_parse();
      var walk = require_walk();
      var stringify = require_stringify();
      function ValueParser(value) {
        if (this instanceof ValueParser) {
          this.nodes = parse(value);
          return this;
        }
        return new ValueParser(value);
      }
      ValueParser.prototype.toString = function() {
        return Array.isArray(this.nodes) ? stringify(this.nodes) : "";
      };
      ValueParser.prototype.walk = function(cb, bubble) {
        walk(this.nodes, cb, bubble);
        return this;
      };
      ValueParser.unit = require_unit();
      ValueParser.walk = walk;
      ValueParser.stringify = stringify;
      module.exports = ValueParser;
    }
  });

  // node_modules/srcset/index.js
  var imageCandidateRegex = /\s*([^,]\S*[^,](?:\s+[^,]+)?)\s*(?:,|$)/;
  var duplicateDescriptorCheck = (allDescriptors, value, postfix) => {
    allDescriptors[postfix] = allDescriptors[postfix] || {};
    if (allDescriptors[postfix][value]) {
      throw new Error(`No more than one image candidate is allowed for a given descriptor: ${value}${postfix}`);
    }
    allDescriptors[postfix][value] = true;
  };
  var fallbackDescriptorDuplicateCheck = (allDescriptors) => {
    if (allDescriptors.fallback) {
      throw new Error("Only one fallback image candidate is allowed");
    }
    if (allDescriptors.x && allDescriptors.x["1"]) {
      throw new Error("A fallback image is equivalent to a 1x descriptor, providing both is invalid.");
    }
    allDescriptors.fallback = true;
  };
  var descriptorCountCheck = (allDescriptors, currentDescriptors) => {
    if (currentDescriptors.length === 0) {
      fallbackDescriptorDuplicateCheck(allDescriptors);
    } else if (currentDescriptors.length > 1) {
      throw new Error(`Image candidate may have no more than one descriptor, found ${currentDescriptors.length}: ${currentDescriptors.join(" ")}`);
    }
  };
  var validDescriptorCheck = (value, postfix, descriptor) => {
    if (Number.isNaN(value)) {
      throw new TypeError(`${descriptor || value} is not a valid number`);
    }
    switch (postfix) {
      case "w": {
        const widthString = descriptor.slice(0, -1);
        if (!/^\d+$/.test(widthString)) {
          throw new TypeError(`Width descriptor must be a valid non-negative integer: ${descriptor}`);
        }
        if (value <= 0) {
          throw new Error("Width descriptor must be greater than zero");
        } else if (!Number.isInteger(value)) {
          throw new TypeError("Width descriptor must be an integer");
        }
        break;
      }
      case "x": {
        const densityString = descriptor.slice(0, -1);
        if (!Number.isFinite(value)) {
          throw new TypeError(`Density descriptor must be a valid floating-point number: ${descriptor}`);
        }
        if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(densityString)) {
          throw new TypeError(`Density descriptor must be a valid floating-point number: ${descriptor}`);
        }
        if (value <= 0) {
          throw new Error("Pixel density descriptor must be greater than zero");
        }
        break;
      }
      case "h": {
        throw new Error("Height descriptor is no longer allowed");
      }
      default: {
        throw new Error(`Invalid srcset descriptor: ${descriptor}`);
      }
    }
  };
  function parseSrcset(string, { strict = false } = {}) {
    const allDescriptors = strict ? {} : void 0;
    return string.replace(/\r?\n/, "").replace(/,\s+/, ", ").split(imageCandidateRegex).filter((part, index) => index % 2 === 1).map((part) => {
      const [url, ...descriptors] = part.trim().split(/\s+/);
      const result = { url };
      if (strict) {
        descriptorCountCheck(allDescriptors, descriptors);
      }
      for (const descriptor of descriptors) {
        const postfix = descriptor[descriptor.length - 1];
        const value = Number.parseFloat(descriptor.slice(0, -1));
        if (strict) {
          validDescriptorCheck(value, postfix, descriptor);
          duplicateDescriptorCheck(allDescriptors, value, postfix);
        }
        switch (postfix) {
          case "w": {
            result.width = value;
            break;
          }
          case "h": {
            result.height = value;
            break;
          }
          case "x": {
            result.density = value;
            break;
          }
        }
      }
      return result;
    });
  }

  // src/vendor/content-parsers.entry.js
  var import_postcss_value_parser = __toESM(require_lib(), 1);
  var scoreSrcsetCandidate = (candidate, order) => {
    if (Number.isFinite(candidate?.width)) return candidate.width;
    if (Number.isFinite(candidate?.density)) return Math.round(candidate.density * 1e3);
    return Math.max(1, 100 - order);
  };
  var parseSrcsetUrls = (srcsetValue) => {
    const raw = String(srcsetValue || "").trim();
    if (!raw) return [];
    try {
      return parseSrcset(raw).map((candidate, order) => ({
        url: String(candidate.url || "").trim(),
        score: scoreSrcsetCandidate(candidate, order)
      })).filter((candidate) => candidate.url).sort((a, b) => b.score - a.score).map((candidate) => candidate.url);
    } catch {
      return [];
    }
  };
  var scoreCssDescriptor = (descriptor, order) => {
    const raw = String(descriptor || "").trim().toLowerCase();
    if (/^\d+(?:\.\d+)?x$/.test(raw)) return Math.round(parseFloat(raw) * 1e3);
    if (/^\d+w$/.test(raw)) return parseInt(raw, 10);
    return Math.max(1, 100 - order);
  };
  var nodeText = (node) => {
    if (!node) return "";
    if (node.type === "string" || node.type === "word") return String(node.value || "").trim();
    return "";
  };
  var collectImageSetCandidates = (node, pushCandidate, getOrder) => {
    let pendingUrl = "";
    for (const child of node.nodes || []) {
      if (child.type === "function" && String(child.value || "").toLowerCase() === "url") {
        pendingUrl = nodeText(child.nodes?.[0]);
        continue;
      }
      if ((child.type === "string" || child.type === "word") && !pendingUrl) {
        pendingUrl = nodeText(child);
        continue;
      }
      if (child.type === "word" && pendingUrl && /^(?:\d+(?:\.\d+)?x|\d+w)$/i.test(child.value || "")) {
        pushCandidate(pendingUrl, child.value, getOrder());
        pendingUrl = "";
        continue;
      }
      if (child.type === "div" && child.value === "," && pendingUrl) {
        pushCandidate(pendingUrl, "", getOrder());
        pendingUrl = "";
      }
    }
    if (pendingUrl) pushCandidate(pendingUrl, "", getOrder());
  };
  var extractCssImageUrls = (cssValue) => {
    const css = String(cssValue || "").trim();
    if (!css || css === "none") return [];
    const candidates = [];
    let order = 0;
    const nextOrder = () => order++;
    const pushCandidate = (url, descriptor, candidateOrder) => {
      const rawUrl = String(url || "").trim();
      if (!rawUrl) return;
      candidates.push({
        url: rawUrl,
        score: scoreCssDescriptor(descriptor, candidateOrder)
      });
    };
    try {
      (0, import_postcss_value_parser.default)(css).walk((node) => {
        const name = String(node.value || "").toLowerCase();
        if (node.type === "function" && name === "url") {
          pushCandidate(nodeText(node.nodes?.[0]), "", nextOrder());
          return false;
        }
        if (node.type === "function" && (name === "image-set" || name === "-webkit-image-set")) {
          collectImageSetCandidates(node, pushCandidate, nextOrder);
          return false;
        }
        return void 0;
      });
    } catch {
      return [];
    }
    return candidates.sort((a, b) => b.score - a.score).map((candidate) => candidate.url);
  };
  globalThis.PageImageCollectorParsers = Object.freeze({
    parseSrcsetUrls,
    extractCssImageUrls
  });
})();
