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

            //console.log(req_path);
            self._query(req_path, result_cb);
        })
    }
};

const MASK_TIME_MODE = (1 << 9);
const MASK_BOOST_MODE = (1 << 6);


const COMMANDS = {
    time_mode: { conf_char: 'N', key: 4 },
    boost_mode: { conf_char: 'N', key: 9 } 
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



    reset_mode(cb) {
        let api = this.api;
        api.set('N', config => {
            config['4'] = 0;
            config['9'] = 0;
        }, config => {
            let cnt = 15;

            let wait = function() {
                cnt -= 1;
                api.get('B', res => {
                    console.log(res.data['0']);
                    if ((res.data['0'] & (MASK_TIME_MODE | MASK_BOOST_MODE)) == 0) {
                        cb(res);
                        return;
                    }
                    if (cnt == 0) {
                        cb(new Error("timeout", 400, {raw: res}));
                        return;
                    }
                    setTimeout(() => {
                        wait(cb);
                    }, 200, 'wait');
                });
            };
            wait();
        })
    }

    _set_mode(time, boost, cb) {
        let api = this.api;
        let self = this;

        let mask = 0;
        if (time) mask |= MASK_TIME_MODE;
        if (boost) mask |= MASK_BOOST_MODE;
        const MASK = MASK_TIME_MODE | MASK_BOOST_MODE;

        api.set('N', config => {
            if (boost) {
                config['9'] = 1;
            } else {
                config['9'] = 0;
            }

            if (time) {
                config['4'] = 1;
            } else {
                config['4'] = 0;
            }
            console.log(config);
        }, config => {
            let cnt = 25;

            let wait = function() {
                cnt -= 1;
                api.get('B', res => {
                    console.log(mask)
                    console.log(res.data['0']);
                    if (is_error(res)) {
                        cb(res);
                        return;
                    }
                    if ((res.data['0'] & MASK) == mask) {
                        cb(res);
                        return;
                    }
                    if (cnt == 0) {
                        cb(new Error("timeout", 400, {raw: res}));
                        return;
                    }
                    setTimeout(() => {
                        wait(cb);
                    }, 200, 'wait');
                });
            };
            wait();
        })
    }

    set_mode(time, boost, cb) {
        this._set_mode(false, false, (res) => {
            if (is_error(res)) {
                cb(res);
                return;
            }
            if (!time && !boost) {
                cb(res);
                return;
            }
            this._set_mode(time, boost, cb);
        });
    }

    reset_uuid() {
        this.api.reset_uuid();
    }

    get(config_char, cb) {
        this.api.get(config_char, cb);
    }

    call(command, val, cb) {
        let cmd = COMMANDS[command];
        this._num_setter(cmd.conf_char, cmd.key, val, res => {
            if (cmd.hotfix) {
                cmd.hotfix(this, res, cb);
            } else {
                cb(res);
            }
        });
    }
};


api = new Daphne2VVApi({host:"192.168.1.162", pin:"2259"});

function dump() {
    api.get('B', res=> {
        console.log(res.data['0']);
        setTimeout(() => {
            dump();
        }, 500, "nasrat2");
    });
}

//dump();
api.set_mode(true, false, res => {
    console.log(res);
});

/*
api.call('time_mode', 1, res => {
    console.log("DONE")
    console.log(res)
   dump()
});
*/


/*
api.set_boost_mode_on(res => {
    console.log(res);
})
*/

/*
api.call('boost_mode', 1, res => {
    console.log("DONE")
    console.log(res)
});
*/

/*
api._num_setter('N', 4, 1, function(stat) {
    console.log(stat)
})
*/

