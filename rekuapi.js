const http = require('http');
const _ = require('lodash');
const uuid = require('uuid')


function is_error(res) {
    if (res instanceof Error) return true;
    return false;
}

class Error {
    constructor(message, code, args = {}) {
        this.message = message;
        this.code = code;
        this.args = args;
    }
}

class RawDaphne2VVApi {
    constructor(args) {
        let g = function(name, def) {
            return _.get(args, 'args.' + name, def);
        }

        args.port = g('port', '80')
        args.uuid = g('uuid', uuid.v4().toUpperCase())
        this.args = args;
    }

    reset_uuid() {
        this.args.uuid = uuid.v4().toUpperCase();
    }

    _opt() {
        let args = this.args;
        return {
            host: args.host,
            port: args.port
        }
    }

    _get_path(conf_char) {
        let args = this.args;
        return '/' + conf_char + '{"id":"GU_V001",' 
            +'"Inst":"' + '{' + args.uuid + '}' + '",'
            +'"Pin":"' + args.pin 
            + '"}'
    }

    _handle_error(json) {
        if (is_error(json)) return json;
        if (json['Pin'] != 'true') {
            return new Error("invalid Pid", 430, { raw: json });
        }
        return json;
    }

    _query(path, cb) {
        let opt = this._opt();
        opt.path = path;

        let callback = response => {
            var str = ''
            response.on('data', function(chunk) {
                str += chunk;
            });
            response.on('end', () =>  {
                let json = JSON.parse(str);
                json = this._handle_error(json);
                cb(json)
            });
        }
        var req = http.request(opt, callback);
        req.end();
    }

    get(conf_char, cb) {
        let path = this._get_path(conf_char);
        this._query(path, cb);
    }

    set(conf_char, setter_cb, result_cb) {
        let self = this;
        this.get(conf_char, json => {
            json = this._handle_error(json);
            if (is_error(json)) {
                result_cb(json);
                return;
            }
            setter_cb(json.data);
            json['Pin'] = self.args.pin;
            let keys = Object.keys(json.data)
            keys.forEach(key => {
                json.data[key] = json.data[key].toString()
            })
            let req_path = '/' + conf_char + JSON.stringify(json)

            self._query(req_path, result_cb);
        })
    }
};

class Daphne2VVApi {
    constructor(args) {
        this.api = new RawDaphne2VVApi(args)
    }
    
    _num_setter(conf_char, key, val, cb) {
        this.api.set('N', function(config) {
            if (config[key.toString()] == val) {
                cb(config);
                return;
            }
            config[key.toString()] = val
        }, function(config) {
            cb(config);
        });
    }

    _def_mask_to_config(mask, config) {
            if ((MASK_BOOST_MODE & mask) != 0) {
                config['9'] = 1;
            } else {
                config['9'] = 0;
            }

            if ((MASK_TIME_MODE & mask) != 0) {
                config['4'] = 1;
            } else {
                config['4'] = 0;
            }
    }

    get(config_char, cb) {
        this.api.get(config_char, cb);
    }

    set_power(n, cb) {
        if (n < 200 || n > 1000) {
            throw Error(500, "invalid power value");
        }
        this.api.set('N', config => {
            config['2'] = n;
        }, config => {
            cb(config);
        });
    }

    get_status(cb) {
        let n = null;
        let b = null;
        api.get('B', b=> {
            api.get('N', n=> {
                let stat = {
                    demandFlow: n.data['2'],
                    actualFlow: b.data['11'],
                    setPoint: n.data['3']
                }
                cb(stat);
            });
        });
    }
};
/*
api = new Daphne2VVApi({host:"192.168.1.162", pin:"2259"});

api.set_power(200, res => {
    api.get_status(stat => {
        console.log(stat);
    })
});
*/

module.exports = Daphne2VVApi;

//dump();


