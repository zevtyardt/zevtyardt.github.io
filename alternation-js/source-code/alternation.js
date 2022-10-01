import { split } from "shlex";
import { groupby } from "itertools";

let _escape_charmaps = [..."#$&()*+-.?[]\\^{}|~"];
const escape = (s) => {
  return [...s].map((i) => {
    return _escape_charmaps.includes(i) ? `\\${i}` : i;
  });
};

const len = (o) => {
  if (!o) return 0;
  if (o instanceof Set) return o.size;
  return Object.keys(o).length;
};

const repr = (o) => {
  return JSON.stringify(o);
};

const reverseString = (s) => {
  return [...s].reverse().join("");
};

function* range(start, stop, step) {
  if (typeof stop == "undefined") {
    stop = start;
    start = 0;
  }
  if (typeof step == "undefined") step = 1;
  if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) return;
  for (var i = start; step > 0 ? i < stop : i > stop; i += step) {
    yield i;
  }
}

// END OF UTILS

const buildTrie = (arr) => {
  const root = {};

  if (!Array.isArray(arr)) {
    arr = split(arr);
  }
  for (let word of arr) {
    for (let index = 0; index < word.length; index++) {
      const token = escape(word[index]);

      let value = root;
      for (let preIndex = 0; preIndex < index; preIndex++) {
        const preToken = value[escape(word[preIndex])];
        if (preToken) {
          value = preToken;
        }
      }

      if (!value[token]) {
        value[token] = {};
      }
      if (index == len(word) - 1) value[token][""] = {};
    }
  }

  const join = (t) => {
    const joined = {};
    for (let [k, v] of Object.entries(t)) {
      v = join(v);
      if (k && len(v) == 1 && !v[""]) {
        const [k2, v2] = Object.entries(v)[0];
        joined[k + k2] = v2;
      } else {
        joined[k] = v;
      }
    }
    return joined;
  };

  return join(root);
};

class RegexGenerator {
  constructor(strings, verbose = true) {
    this.verbose = verbose;
    this.ESCAPE_CHARS = [..."#$&()*+-.?[]\\^{}|~"];
    this.trie = buildTrie(strings);
    this.strings = strings;
    this.regex = "";
    this.level = 0;
  }

  _log(s, i) {
    if (!this.verbose) return;
    let d = "";
    for (let i = 0; i < this.level; i++) d = d + "  ";
    console.log(`${d}${s} \x1b[92m=>\x1b[0m ${JSON.stringify(i)}`);
  }

  serialize_regex = (d, level = 0) => {
    this.level = level;
    if (!d && level == 0) d = this.trie;
    let s = "";

    this._log("serializer:input", { d: d, level: level });
    const data = {
      keys: Object.keys(d),
      values: Object.values(d),
      items: Object.entries(d),
      obj: d,
    };

    if (d && this.is_char_class(data)) {
      s = this.as_char_class(data.keys);
    } else if (d && this.all_suffixes_identical(data)) {
      this._log("this suffixes identical");
      let v = data.values[0];
      if (this.all_len1(data.keys)) {
        s = this.as_charclass(data.keys);
      } else if (this.is_optional_char_class(data)) {
        s = this.as_opt_charclass(data.keys);
      } else if (this.is_optional(data)) {
        s = this.as_optional_group(data.keys);
      } else {
        s = this.as_group(data.keys);
      }
      s = s + this.serialize_regex(v, level + 1);
    } else if (this.is_optional_char_class(data)) {
      this._log("this optional char class");
      s = this.as_opt_charclass(data.keys);
    } else if (this.is_optional(data)) {
      this._log("this optional");
      s = this.opt_group(
        // escape
        data.keys.sort()[1]
      );
    } else {
      this._log("this else");
      const bysuff = this.suffixes(data);
      this._log("serializer:bysuff", bysuff);
      const grouped = [];
      if (len(bysuff) < len(data.keys)) {
        for (let [k, v] of bysuff) {
          k = this.repr_keys(k, level > 0);
          v = this.serialize_regex(v, level + 1);
          grouped.push(k + v);
        }
        this._log("serializer:suffixes", grouped);
      } else {
        for (let [k, v] of data.items.sort()) {
          v = len(v) > 0 ? this.serialize_regex(v, level + 1) : "";
          grouped.push(k + v);
        }
        this._log("serializer:grouped", grouped, true);
      }
      s = this.group(grouped);
    }
    this._log("serializer:output", s);
    this.level = level - 1;
    this.regex = s;
    return s;
  };

  // utils
  repr_keys(l, do_group = true) {
    if (this.all_len1(l)) {
      return this.as_charclass(l);
    } else if (this.all_len01(l)) {
      return this.as_opt_charclass(l);
    } else {
      return this.as_group(l, do_group);
    }
  }
  emptyish(k) {
    if (["{}", '{"":{}}'].includes(JSON.stringify(k))) {
      return {};
    }
    return k;
  }

  // all_ functions
  all_len1(k) {
    return k.every((i) => {
      return len(i) == 1;
    });
  }
  all_len01(k) {
    k = k
      .map((i) => {
        return len(i);
      })
      .sort();
    const listSet = [...new Set(k)];
    return JSON.stringify(listSet) == "[0,1]";
  }
  all_values_not(v) {
    return v.every((i) => {
      return ["{}", '{"":{}}'].includes(JSON.stringify(i));
    });
  }
  all_suffixes_identical(d) {
    const values = d.values;
    const uniq = new Set(
      values.map((i) => {
        return JSON.stringify(i);
      })
    );
    return len(values) > 1 && len(uniq) == 1;
  }
  all_digits(l) {
    const re = /^\d+$/;
    return l.every((i) => {
      return re.test(i);
    });
  }

  // is_ & has_ functions
  is_optional(d) {
    if (len(d.keys) == 2) {
      const items = d.items.sort();
      return (
        !items[0][0] &&
        ('{"":{}}' == JSON.stringify(items[1][1]) || len(items[1][1]) == 1)
      );
    }
  }
  is_optional_char_class(d) {
    return this.all_len01(d.keys) && this.all_values_not(d.values);
  }
  is_char_class(d) {
    return this.all_len1(d.keys) && this.all_values_not(d.values);
  }
  is_optional_strings(l) {
    return !l.every((i) => {
      return len(i) > 0;
    });
  }
  is_unescape_char_in_string(s) {
    for (let [index, char] of Object.entries(s)) {
      if (this.ESCAPE_CHARS.includes(char)) {
        if (index == 0) {
          if (char == "\\" && this.ESCAPE_CHARS.includes(s[index + 1])) {
            continue;
          }
          return true;
        } else {
          if (!s[index - 1].endsWith("\\")) {
            if (index < len(s)) {
              if (char == "\\" && this.ESCAPE_CHARS.includes(s[index + 1])) {
                continue;
              }
            }
            return true;
          }
        }
      }
    }
  }

  // main functions
  as_opt_charclass(k) {
    this._log("as_opt_charclass:input", k);
    let s = this.condense_range(k);
    if (len(k) > 2) {
      s = `[${s}]`;
    } else {
      s = escape(s); // XXX
    }
    this._log("as_opt_charclass:output", s + "?");
    return s + "?";
  }
  as_charclass(l) {
    this._log("as_charclass:input", l);
    let s = this.condense_range(l);
    if (len(s) > 1) s = `[${s}]`;
    this._log("as_charclass:output", s);
    return s;
  }
  as_char_class(l) {
    this._log("as_char_class:input", l);
    let s = l.sort();
    this._log("as_char_class:sorted", s);
    if (len(s) > 1) {
      s = `[${this.condense_range(s)}]`;
    }
    this._log("as_char_class:output", s);
    return s;
  }
  as_optional_group(l) {
    l = l.sort();
    this._log("as_optional_group:input_sorted", l);

    let s,
      j = l.splice(1);

    if (len(j) == 0) {
      s = "";
    } else {
      this._log("as_optional_group:j", j);
      if (this.all_digits(j) && this.all_len1(j)) {
        s = this.condense_range(j);
        if (len(s) > 1) s = `[${s}]`;
        this._log("as_optional_group:j_digits", s);
      } else {
        let is_len1 = this.all_len1(j);
        if (len(j) > 1) j = [this.as_group(j)];
        s = j.join("|");
        this._log("as_optional_group:joined_as_group:j", s);
        if (
          !is_len1 &&
          (len(j) > 1 ||
            len(j[0]) > 1 ||
            s.endsWith("?") ||
            s.indexOf("|") >= 0 ||
            s.indexOf("(?:") >= 0)
        ) {
          if (!s.startsWith("(?:")) s = `${len(j) > 1 ? "(?:" : "("}${s})`;
        }
      }
    }
    if (s) s = s + "?";
    this._log("as_optional_group:output", s);
    return s;
  }
  as_group(l, do_group = true) {
    l = l.sort();
    this._log("as_group:input", { l_sorted: l, do_group: do_group });

    const find_suffix_dogroup = (l) => {
      this._log("as_group:find_suffix_dogroup:input", l);
      let suffix, dogroup;

      suffix = len(l) > 1 ? this.longest_suffix(l) : "";
      this._log("as_group:find_suffix_dogroup:suffix", suffix);
      //suffix = this.is_unescape_char_in_string(suffix) ? suffix : "";
      //this._log("as_group:find_suffix_dogroup:suffix_2", suffix);
      dogroup = suffix != "" ? len(suffix) > 0 : do_group;
      this._log("as_group:find_suffix_dogroup:dogroup", dogroup);
      return [suffix, dogroup];
    };

    let [suffix, dogroup] = find_suffix_dogroup(l);
    let s;
    if (suffix) {
      const lensuff = len(suffix);
      const prefixes = l.map((i) => {
        return reverseString([...reverseString(i)].splice(lensuff));
      });
      this._log("as_group:prefixes", prefixes);
      if (this.all_len1(prefixes)) {
        s = this.as_char_class(prefixes);
      } else {
        s = this.group(prefixes);
      }
      s = s + suffix;
    } else {
      s = this.group(l, (do_group = dogroup));
    }
    this._log("as_group:output", s);
    return s;
  }
  opt_group(s) {
    this._log("opt_group:input", s);
    if (len(s) - (s.split("\\").length - 1) > 1) {
      s = `${len(s.split(" ")) > 1 ? "(?:" : "("}${s})`;
    }
    s = s + "?";
    this._log("opt_group:output", s);
    return s;
  }

  // algorithm functions
  longest_suffix(l) {
    return this.longest_preffix(
      l.map((i) => {
        return reverseString(i);
      })
    );
  }
  longest_preffix(l) {
    if (len(l) == 0) return "";
    let prefix = l[0];
    let longest = Math.min(
      ...l.map((i) => {
        return len(i);
      })
    );

    const longest_prefix_2strings = (x, y, longest) => {
      const length = Math.min(Math.min(len(x), len(y), longest));
      for (let i of range(1, length + 1)) {
        let x_ = [...x].splice(0, i).join("");
        let y_ = [...y].splice(0, i).join("");
        if (x_ != y_) return i - 1;
      }
      return length;
    };

    for (let i of range(1, len(l))) {
      longest = longest_prefix_2strings(prefix, l[i], longest);
      if (longest == 0) return "";
    }
    return reverseString([...prefix].splice(0, longest));
  }
  group(l, do_group = true) {
    let s;
    this._log("group:input", { l: l, do_group: do_group });
    l = l.map((i) => {
      return i.replace("\\\\\\", "\\");
    });
    if (this.is_optional_strings(l)) {
      s = this.as_optional_group(l);
      this._log("group:as_optional_group", s);
    } else {
      l = this.condense_len1(l);
      l = this.condense_prefix(l);

      /*
      console.log(
        l,
        this.condense_prefix(
          l
            .filter((i) => {
              return i.endsWith("e");
            })
            .map((i) => {
              return reverseString(i);
            })
        ).map((i) => {
          return reverseString(i);
        })
      );*/
      s = l.join("|");

      if (
        do_group &&
        (len(l) > 1 || (s.indexOf("|") >= 0 && s.indexOf("(?:") < 0))
      ) {
        s = `${len(l) > 1 ? "(?:" : "("}${s})`;
      }
    }

    this._log("group:output", s);
    return s;
  }
  suffixes(d) {
    this._log("suffixes:input", d.items);
    const items = d.items.sort((a, b) => {
      a = repr(this.emptyish(a));
      b = repr(this.emptyish(b));
      return a < b;
    });
    const grouped = [];
    for (let [k, g] of groupby(items, (i) => {
      return this.emptyish(i[1]);
    })) {
      grouped.push([
        k,
        [...g].map((i) => {
          return i[0];
        }),
      ]);
    }

    const out = grouped.sort((a, b) => {
      a = [repr(a[1]), repr[a[0]]];
      b = [repr(b[1]), repr[b[0]]];
      return a < b;
    });

    this._log("suffixes:output", out);
    return out;
  }

  // condense_
  condense_len1(l) {
    this._log("condense_len1:input", l);
    const chr2group = [];
    for (let char of l.sort()) {
      if (len(char) == 1) chr2group.push(char);
    }
    this._log("condense_len1:chr2group", chr2group);
    l = l.filter((v) => {
      return !chr2group.includes(v);
    });
    if (len(chr2group) > 0) {
      let s = this.condense_range(chr2group);
      if (len(chr2group) > 1) s = `[${s}]`;
      l.splice(0, 0, s);
    }

    this._log("condense_len1:output", l.sort());
    return l.sort();
  }

  condense_prefix(l) {
    this._log("condense_prefix:input", l);
    const prefixes = {};
    for (let char of l.sort()) {
      if (char.indexOf("(?:") >= 0 || char.indexOf("|") >= 0) continue;

      let suf = char[len(char) - 1];
      if (_escape_charmaps.includes(suf)) continue;
      if (!prefixes[suf]) prefixes[suf] = [];
      prefixes[suf].push(char);
      l = l.filter((i) => {
        return i != char;
      });
    }
    this._log("condense_prefix:prefixes", prefixes);
    let nl = [];
    for (let [suf, chars] of Object.entries(prefixes)) {
      suf = this.longest_suffix(chars);
      chars = chars.map((i) => {
        return i.substring(0, len(i) - len(suf));
      });
      let pre = this.as_group(chars);
      nl.push(`${pre}${suf}`);
    }
    l = [...nl, ...l];
    this._log("condense_prefix:output", l);
    return l;
  }
  condense_range(chars) {
    this._log("condense_range:input", chars);
    chars = chars.filter((i) => {
      return i;
    });

    const condensed = [];
    while (len(chars) > 0) {
      let i = 1;
      while (i < len(chars)) {
        if (chars[i] != String.fromCharCode(chars[i - 1].charCodeAt() + 1))
          break;
        i++;
      }
      if (i <= 1) {
        condensed.push(chars[0].toString());
      } else if (i == 2) {
        condensed.push(`${chars[0]}${chars[1]}`);
      } else {
        condensed.push(`${chars[0]}-${chars[i - 1]}`);
      }
      if (i == len(chars)) {
        chars = [];
      } else {
        chars.splice(0, i);
      }
    }
    this._log("condense_range:output", condensed.join(""));
    return condensed.join("");
  }

  // other
  test_all() {
    this.regex = RegExp(`^${this.regex}$`);
    const data = {};
    const words = Array.isArray(this.strings)
      ? this.strings
      : split(this.strings);
    for (let word of words) {
      data[word] = this.regex.test(word);
    }
    return data;
  }
}

//export default RegexGenerator;

const s = process.argv.splice(2).join(" ");

const serializer = new RegexGenerator(s);
console.log(
  JSON.stringify(
    {
      input: s,
      output: serializer.serialize_regex() || serializer.trie,
      test_all: serializer.test_all(),
    },
    null,
    2
  )
);
