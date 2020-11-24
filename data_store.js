const SELECTOR_PREFIX = 'selector::';

class DataStore {
  constructor() {
    this.store = {};

    this.listeners = {};
    this.selectors = {};
  }

  _initDataStoreItem(name, value) {
    if (!this.store.hasOwnProperty(name)) {
      this.store[name] = {
        _data: value,
        _selectors: []
      };
      this.listeners[name] = [];
    }
  }

  /**
   * 初始化data store.
   * @param {object} initialObject 初始化对象.
   * 格式:
   * {
   *   data: {
   *     foo: 'initial_value',
   *     bar: 123
   *   },
   *   selectors: [ 'quz', 'baz' ]
   * }
   */
  initDataStore({ data = {}, selectors = [] }) {
    Object.entries(data).forEach(([ name, initialValue ]) => {
      this._initDataStoreItem(name, initialValue);
    });

    selectors.forEach((selectorName) => {
      if (selectorName.indexOf(SELECTOR_PREFIX) !== 0) {
        selectorName = `${SELECTOR_PREFIX}${selectorName}`;
      }

      this.selectors[selectorName] = {
        _transformer: () => {},
        _deps: [],
        _listeners: []
      };
    });
  }

  /**
   * 使用Hook (React Hook)对状态进行管理、使用。
   * @param {React} react React实例。通常就是import进来的那个React。
   * @param {string[]} deps Data store中的Data或Selector项。
   * @returns {[state, func, func]}
   */
  bindStateHook(react, deps) {
    const self = this;
    const state = {};
    const listeners = [];

    (deps||[]).reduce((accum, dataStoreName) => {
      const [ stateInstace, updateStateInstance ] = react.useState(this.get(dataStoreName));

      accum[dataStoreName] = [
        stateInstace,
        (value) => {
          this.update(dataStoreName, value);
        }
      ];

      const addListenerMethod = dataStoreName.indexOf(SELECTOR_PREFIX) === 0 ? 'addSelectorListener' : 'addDataListener';
      listeners.push({
        listener: null,
        onMount() {
          this.listener = self[addListenerMethod](dataStoreName, (data) => {
            updateStateInstance(data);
          }, true);
        },
        onUnmount() {
          if (this.listener) {
            this.listener.remove();
          }
        }
      });

      return accum;
    }, state);

    return [
      {...state},
      /**
       * Initiate hook in Effect.
       */
      () => {
        listeners.forEach((listener) => {
          listener.onMount();
        });
      },
      /**
       * Clear listeners in Effect.
       */
      () => {
        listeners.forEach((listener) => {
          listener.onUnmount();
        });
      }
    ];

  }

  /**
   * 将data store中的data及selector绑定到component的state上。
   * @param {class} component 需要绑定的组件
   * @param {object} mapping state映射。
   * @returns {object} 生成的state对象，用以插入到component的state中。
   * 例如:
   * {
   *    'foo': 'state_in_component',
   *    'selector::bar': ['state_a', 'state_b']
   * }
   */
  bindState(component, mapping) {
    const self = this;
    const state = {};
    const listeners = [];

    Object.entries(mapping).reduce((accum, [ dataStoreName, targetNames ]) => {
      if (!Array.isArray(targetNames)) {
        targetNames = [targetNames];
      }

      targetNames.forEach((targetName) => {
        accum[targetName] = this.get(dataStoreName);
      });

      const addListenerMethod = dataStoreName.indexOf(SELECTOR_PREFIX) === 0 ? 'addSelectorListener' : 'addDataListener';
      listeners.push({
        listener: null,
        onMount() {
          this.listener = self[addListenerMethod](dataStoreName, (data) => {
            const state = targetNames.reduce((stateAccum, targetName) => {
              stateAccum[targetName] = data;
              return stateAccum;
            }, {});

            component.setState(state);
          }, true);
        },
        onUnmount() {
          if (this.listener) {
            this.listener.remove();
          }
        }
      });

      return accum;
    }, state);

    return {
      state,
      didMount() {
        listeners.forEach((listener) => {
          listener.onMount();
        });
      },
      willUnmount() {
        listeners.forEach((listener) => {
          listener.onUnmount();
        });
      }
    };
  }

  update(name, data) {
    this._initDataStoreItem(name);

    const prevData = this.store[name]._data;

    this.store[name]._data = data;

    const depSelectors = this.store[name]._selectors;

    // 遍历data listener...
    this.listeners[name].forEach(({ onChange }) => {
      onChange(data, prevData);
    });
    // 遍历selector listener...
    depSelectors.forEach((selectorName) => {
      const { _listeners: selectorListeners } = this.selectors[selectorName];

      selectorListeners.forEach(({ onChange }) => {
        onChange(this.getSelector(selectorName));
      });
    });

    return this;
  }

  getSelector(name) {
    if (!this.selectors.hasOwnProperty(name)) throw new Error(`尚未定义selector: ${name}`);

    const { _transformer, _deps } = this.selectors[name];
    const depData = _deps.map((dep) => this.store[dep]._data);
    return _transformer(...depData);
  }

  get(name) {
    if (name.indexOf(SELECTOR_PREFIX) === 0) {
      return this.getSelector(name);
    } else {
      return this.store[name]._data;
    }
  }

  defineSelector(selectorName, depNames, transformer) {
    if (typeof selectorName !== 'string') {
      throw new TypeError('未定义selector名称');
    }

    if (selectorName.indexOf(SELECTOR_PREFIX) !== 0) {
      selectorName = `${SELECTOR_PREFIX}${selectorName}`;
    }

    if (!Array.isArray(depNames)) {
      depNames = [depNames];
    }

    depNames.forEach((dep) => {
      const storeItem = this.store[dep];
      if (storeItem._selectors.indexOf(selectorName) === -1) {
        storeItem._selectors.push(selectorName);
      }
    });

    this.selectors[selectorName] = {
      _transformer: transformer,
      _deps: depNames,
      _listeners: []
    };
  }

  addSelectorListener(selectorName, onChange, executeImmediately = false) {
    if (selectorName.indexOf(SELECTOR_PREFIX) !== 0) {
      selectorName = `${SELECTOR_PREFIX}${selectorName}`;
    }

    const self = this;

    const listener = {
      onChange,
      _removed: false,
      remove() {
        this._removed = true;

        self.selectors[selectorName]._listeners = [
          ...self.selectors[selectorName]._listeners.filter(({_removed}) => !_removed)
        ];
      }
    };

    this.selectors[selectorName]._listeners.push(listener);
    if (executeImmediately) {
      onChange(this.getSelector(selectorName));
    }

    return listener;
  }

  addDataListener(targetName, onChange, executeImmediately = false) {
    this._initDataStoreItem(targetName);

    const self = this;

    const listener = {
      onChange,
      _removed: false,
      remove() {
        this._removed = true;

        self.listeners[targetName] = [...self.listeners[targetName].filter(({_removed}) => !_removed)];
      }
    };

    this.listeners[targetName].push(listener);

    if (executeImmediately) {
      onChange(this.store[targetName]._data);
    }

    return listener;
  }
}

const store = new DataStore();

export const dataStore = {
  initDataStore: store.initDataStore.bind(store),
  bindState: store.bindState.bind(store),
  bindStateHook: store.bindStateHook.bind(store),
  update: store.update.bind(store),
  get: store.get.bind(store),
  getSelector: store.getSelector.bind(store),
  addDataListener: store.addDataListener.bind(store),
  addSelectorListener: store.addSelectorListener.bind(store),
  defineSelector: store.defineSelector.bind(store)
};
