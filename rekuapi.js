const http = require('http');
const _ = require('lodash');
const uuid = require('uuid')

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
        if (json instanceof Error) {
            return json;
        }
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
            if (json instanceof Error) {
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

const COMMANDS = {
    time_mode: { conf_char: 'N', key: 4 },
    boost_mode: {
        conf_char: 'N',
        key: 9,
        hotfix: function(api, result, cb) {
            // force reenable time mode
            if (result.data['4'] == 1) {
                console.log('hotfix (timemode)');
                api.call('time_mode', 0, res => {
                    api.call('time_mode', 1, res => {
                        cb(result);
                    });                
                })
            } else {
                cb(result);
            }
        }
    } 
};


class Daphne2VVApi {
    constructor(args) {
        this.api = new RawDaphne2VVApi(args)
    }
    
    _num_setter(conf_char, key, val, cb) {
        this.api.set('N', function(config) {
            config[key.toString()] = val
        }, function(config) {
            cb(config);
        });
    }

    set_boost_mode_on(cb) {
        this.api.set('N', config => {
            config['4'] = 0;
            config['9'] = 1;
        }, config => {
            setTimeout(() => {
                this.api.set('N', config => {
                    config['4'] = 1;
                }, config => {
                    cb(config);                    
                })
            }, 1000, "nasrat!");
        })
    }

    set_boost_mode_off(cb) {
        this.api.set('N', config => {
            config['4'] = 1;
            config['9'] = 0;
        }, config => {
            cb(config);                    
        })
    }


    reset_uuid() {
        this.api.reset_uuid();
    }

    get(cb) {
        this.api.get('N', cb);
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
/*
api.call('time_mode', 1, res => {
    console.log("DONE")
    console.log(res)
});
*/


api.set_boost_mode_on(res => {
    console.log(res);
})

/*
api.get(res=> {
    console.log(res);
});

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

