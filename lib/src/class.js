"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const t = require("babel-types");
const path_1 = require("path");
const utils_1 = require("./utils");
const constant_1 = require("./constant");
const lodash_1 = require("lodash");
const render_1 = require("./render");
const jsx_1 = require("./jsx");
const adapter_1 = require("./adapter");
const babel_generator_1 = require("babel-generator");
const env_1 = require("./env");
const functional_1 = require("./functional");
const render_props_1 = require("./render-props");
const stopPropagationExpr = require('babel-template')(`typeof e === 'object' && e.stopPropagation && e.stopPropagation()`);
const NODE_MODULES = 'node_modules';
function buildConstructor() {
    const ctor = t.classMethod('constructor', t.identifier('constructor'), [t.identifier('props')], t.blockStatement([
        t.expressionStatement(t.callExpression(t.identifier('super'), [
            t.identifier('props')
        ]))
    ]));
    return ctor;
}
function processThisPropsFnMemberProperties(member, path, args) {
    const propertyArray = [];
    function traverseMember(member) {
        const object = member.object;
        const property = member.property;
        if (t.isIdentifier(property)) {
            propertyArray.push(property.name);
        }
        if (t.isMemberExpression(object)) {
            if (t.isThisExpression(object.object) &&
                t.isIdentifier(object.property) &&
                object.property.name === 'props') {
                if (!adapter_1.isNewPropsSystem()) {
                    path.replaceWith(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier('__triggerPropsFn')), [t.stringLiteral(propertyArray.reverse().join('.')), t.callExpression(t.memberExpression(t.arrayExpression([t.nullLiteral()]), t.identifier('concat')), [t.arrayExpression(args)])]));
                }
            }
            traverseMember(object);
        }
    }
    traverseMember(member);
}
class Transformer {
    constructor(path, sourcePath, componentProperies, sourceDir, methods) {
        this.result = {
            template: '',
            components: [],
            componentProperies: []
        };
        this.renderJSX = new Map();
        this.refIdMap = new Map();
        this.initState = new Set();
        this.customComponents = new Map();
        this.anonymousMethod = new Map();
        this.customComponentNames = new Set();
        this.usedState = new Set();
        this.refs = [];
        this.loopRefs = new Map();
        this.anonymousFuncCounter = utils_1.incrementId();
        this.importJSXs = new Set();
        this.refObjExpr = [];
        this.buildAnonyMousFunc = (jsxExpr, attr, expr) => {
            const exprPath = attr.get('value.expression');
            const stemParent = jsxExpr.getStatementParent();
            const counter = this.anonymousFuncCounter();
            const anonymousFuncName = `${constant_1.ANONYMOUS_FUNC}${counter}`;
            const isCatch = utils_1.isContainStopPropagation(exprPath);
            const classBody = this.classPath.node.body.body;
            const loopCallExpr = jsxExpr.findParent(p => utils_1.isArrayMapCallExpression(p));
            let index;
            const self = this;
            if (loopCallExpr) {
                index = lodash_1.get(loopCallExpr, 'node.arguments[0].params[1]');
                if (!t.isIdentifier(index)) {
                    index = t.identifier('__index' + counter);
                    lodash_1.set(loopCallExpr, 'node.arguments[0].params[1]', index);
                }
                classBody.push(t.classProperty(t.identifier(anonymousFuncName + 'Map'), t.objectExpression([])));
                const indexKey = stemParent.scope.generateUid('$indexKey');
                // tslint:disable-next-line: no-inner-declarations
                function findParentLoopCallExprIndices(callExpr) {
                    const indices = new Set([]);
                    // tslint:disable-next-line: no-conditional-assignment
                    while (callExpr = callExpr.findParent(p => utils_1.isArrayMapCallExpression(p) && p !== callExpr)) {
                        let index = lodash_1.get(callExpr, 'node.arguments[0].params[1]');
                        if (!t.isIdentifier(index)) {
                            index = t.identifier('__index' + self.anonymousFuncCounter());
                            lodash_1.set(callExpr, 'node.arguments[0].params[1]', index);
                        }
                        indices.add(index);
                    }
                    return indices;
                }
                const indices = [...findParentLoopCallExprIndices(loopCallExpr)].reverse();
                const indexKeyDecl = t.variableDeclaration('const', [t.variableDeclarator(t.identifier(indexKey), indices.length === 0
                        ? t.binaryExpression('+', t.stringLiteral(utils_1.createRandomLetters(5)), index)
                        : t.templateLiteral([
                            t.templateElement({ raw: utils_1.createRandomLetters(5) }),
                            ...indices.map(() => t.templateElement({ raw: '-' })),
                            t.templateElement({ raw: '' })
                        ], [
                            ...indices.map(i => t.identifier(i.name)),
                            index
                        ]))]);
                const func = loopCallExpr.node.arguments[0];
                if (t.isArrowFunctionExpression(func)) {
                    const body = loopCallExpr.get('arguments')[0].get('body.body');
                    if (!t.isBlockStatement(func.body)) {
                        func.body = t.blockStatement([
                            indexKeyDecl,
                            t.returnStatement(func.body)
                        ]);
                    }
                    else {
                        // func.body.body.push(indexKeyDecl)
                        // 只有 path 的方法才能触发 traverse
                        body[body.length - 1].insertBefore(indexKeyDecl);
                    }
                    const arrayFunc = t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier(anonymousFuncName + 'Map')), t.identifier(indexKey), true);
                    classBody.push(t.classMethod('method', t.identifier(anonymousFuncName), [t.identifier(indexKey), t.restElement(t.identifier('e'))], t.blockStatement([
                        isCatch ? stopPropagationExpr() : t.emptyStatement(),
                        t.returnStatement(t.logicalExpression('&&', arrayFunc, t.callExpression(arrayFunc, [t.spreadElement(t.identifier('e'))])))
                    ])));
                    exprPath.replaceWith(t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier(anonymousFuncName)), t.identifier('bind')), [t.thisExpression(), t.identifier(indexKey)]));
                    body[body.length - 1].insertBefore(t.expressionStatement(t.assignmentExpression('=', arrayFunc, expr)));
                }
                else {
                    throw utils_1.codeFrameError(func, '返回 JSX 的循环语句必须使用箭头函数');
                }
            }
            else {
                classBody.push(t.classMethod('method', t.identifier(anonymousFuncName), [t.identifier('e')], t.blockStatement([
                    isCatch ? t.expressionStatement(t.callExpression(t.memberExpression(t.identifier('e'), t.identifier('stopPropagation')), [])) : t.emptyStatement()
                ])));
                exprPath.replaceWith(t.memberExpression(t.thisExpression(), t.identifier(anonymousFuncName)));
                stemParent.insertBefore(t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.thisExpression(), t.identifier(anonymousFuncName)), expr)));
            }
        };
        this.jsxClosureFuncDecl = new Set();
        this.renameJSXClassFunc = (propName, methodName, callPath, args, isClosure = false) => {
            const parentPath = callPath.parentPath;
            if (parentPath.isCallExpression()) {
                return;
            }
            const callee = !isClosure
                ? t.memberExpression(t.thisExpression(), t.identifier(`_create${propName.slice(6)}Data`))
                : t.identifier(propName);
            const templateAttr = [
                t.jSXAttribute(t.jSXIdentifier('is'), t.stringLiteral(propName)),
                t.jSXAttribute(t.jSXIdentifier('data'), t.jSXExpressionContainer(t.callExpression(t.callExpression(callee, [t.binaryExpression('+', methodName === 'render'
                        ? t.identifier('__prefix')
                        : t.identifier(constant_1.CLASS_COMPONENT_UID), t.stringLiteral(utils_1.createRandomLetters(10)))]), args)))
            ];
            this.jsxClosureFuncDecl.add(parentPath);
            callPath.replaceWith(t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('Template'), templateAttr), t.jSXClosingElement(t.jSXIdentifier('Template')), [], false));
        };
        this.buildPropsAnonymousFunc = (attr, expr, isBind = false, path) => {
            const { code } = babel_generator_1.default(expr);
            const id = t.isMemberExpression(expr.callee) ? utils_1.findFirstIdentifierFromMemberExpression(expr.callee) : null;
            if (code.startsWith('this.props') ||
                (id && utils_1.isDerivedFromProps(attr.scope, id.name))) {
                const methodName = utils_1.findMethodName(expr);
                const uniqueMethodName = `${methodName}${String(isBind)}`;
                const hasMethodName = this.anonymousMethod.has(uniqueMethodName) || !methodName;
                const funcName = hasMethodName
                    ? this.anonymousMethod.get(uniqueMethodName)
                    // 测试时使用1个稳定的 uniqueID 便于测试，实际使用5个英文字母，否则小程序不支持
                    : env_1.isTestEnv ? lodash_1.uniqueId('funPrivate') : `funPrivate${utils_1.createRandomLetters(5)}`;
                this.anonymousMethod.set(uniqueMethodName, funcName);
                const newVal = isBind
                    ? t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier(funcName)), t.identifier('bind')), expr.arguments || [])
                    : t.memberExpression(t.thisExpression(), t.identifier(funcName));
                attr.get('value.expression').replaceWith(newVal);
                this.methods.set(funcName, null);
                this.componentProperies.add(methodName);
                if (hasMethodName) {
                    return;
                }
                const attrName = attr.node.name;
                if (t.isJSXIdentifier(attrName) && attrName.name.startsWith('on')) {
                    this.componentProperies.add(`${constant_1.FN_PREFIX}${attrName.name}`);
                }
                if (methodName.startsWith('on')) {
                    this.componentProperies.add(`${constant_1.FN_PREFIX}${methodName}`);
                }
                const method = !adapter_1.isNewPropsSystem() ?
                    t.classMethod('method', t.identifier(funcName), [], t.blockStatement([
                        t.expressionStatement(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier('__triggerPropsFn')), [t.stringLiteral(methodName), t.arrayExpression([t.spreadElement(t.identifier('arguments'))])]))
                    ])) :
                    t.classMethod('method', t.identifier(funcName), [], t.blockStatement([
                        t.returnStatement(t.callExpression(t.memberExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier('props')), t.identifier(methodName)), t.identifier('apply')), [
                            isBind ? t.identifier('this') : t.identifier('undefined'),
                            t.callExpression(t.memberExpression(t.memberExpression(t.memberExpression(t.identifier('Array'), t.identifier('prototype')), t.identifier('slice')), t.identifier('call')), [t.identifier('arguments'), t.numericLiteral(1)])
                        ]))
                    ]));
                this.classPath.node.body.body = this.classPath.node.body.body.concat(method);
            }
            else if (t.isMemberExpression(expr) && !t.isThisExpression(expr.object)) {
                // @TODO: 新旧 props 系统在事件处理上耦合太深，快应用应用新 props 把旧 props 系统逻辑全部清楚
                this.buildAnonyMousFunc(path, attr, expr);
            }
        };
        this.classPath = path;
        this.sourcePath = sourcePath;
        this.sourceDir = sourceDir;
        this.moduleNames = Object.keys(path.scope.getAllBindings('module'));
        this.componentProperies = new Set(componentProperies);
        this.methods = methods;
        this.compile();
    }
    setMultipleSlots() {
        const body = this.classPath.node.body.body;
        if (body.some(c => t.isClassProperty(c) && c.key.name === 'multipleSlots')) {
            return;
        }
        const multipleSlots = t.classProperty(t.identifier('multipleSlots'), t.booleanLiteral(true));
        multipleSlots.static = true;
        body.push(multipleSlots);
    }
    createStringRef(componentName, id, refName) {
        this.refs.push({
            type: constant_1.DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component',
            id,
            refName
        });
    }
    createFunctionRef(componentName, id, fn) {
        this.refs.push({
            type: constant_1.DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component',
            id,
            fn
        });
    }
    handleRefs() {
        this.refObjExpr = this.refs.map(ref => {
            return t.objectExpression([
                t.objectProperty(t.identifier('type'), t.stringLiteral(ref.type)),
                t.objectProperty(t.identifier('id'), t.stringLiteral(ref.id)),
                t.objectProperty(t.identifier('refName'), t.stringLiteral(ref.refName || '')),
                t.objectProperty(t.identifier('fn'), ref.fn ? ref.fn : t.nullLiteral())
            ]);
        });
        const _constructor = this.classPath.node.body.body.find(item => {
            const constructorName = env_1.isTestEnv ? 'constructor' : '_constructor';
            if (t.isClassMethod(item) && t.isIdentifier(item.key) && item.key.name === constructorName) {
                return true;
            }
            return false;
        });
        if (_constructor && t.isClassMethod(_constructor) && adapter_1.Adapter.type !== "quickapp" /* quickapp */) {
            _constructor.body.body.push(t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.thisExpression(), t.identifier('$$refs')), t.newExpression(t.memberExpression(t.identifier('Taro'), t.identifier('RefsArray')), []))));
        }
    }
    setComponentPath() {
        let componentPath;
        const nodeModulesIndex = this.sourcePath.indexOf(NODE_MODULES);
        if (nodeModulesIndex >= 0) {
            componentPath = this.sourcePath.substring(nodeModulesIndex);
        }
        else {
            componentPath = this.sourcePath.replace(this.sourceDir, '');
        }
        componentPath = componentPath.replace(path_1.extname(componentPath), '');
        componentPath = componentPath.split(path_1.sep).join('/');
        if (componentPath.startsWith('/')) {
            componentPath = componentPath.slice(1);
        }
        const $$componentPath = t.classProperty(t.identifier('$$componentPath'), t.stringLiteral(componentPath));
        $$componentPath.static = true;
        this.classPath.node.body.body.push($$componentPath);
    }
    traverse() {
        const self = this;
        let hasRender = false;
        self.classPath.traverse({
            JSXOpeningElement: (path) => {
                const jsx = path.node;
                const attrs = jsx.attributes;
                if (!t.isJSXIdentifier(jsx.name)) {
                    return;
                }
                const loopCallExpr = path.findParent(p => utils_1.isArrayMapCallExpression(p));
                const componentName = jsx.name.name;
                const refAttr = jsx_1.findJSXAttrByName(attrs, 'ref');
                if (!refAttr) {
                    return;
                }
                const idAttr = jsx_1.findJSXAttrByName(attrs, 'id');
                let id = utils_1.createRandomLetters(5);
                let idExpr;
                if (!idAttr) {
                    if (loopCallExpr && loopCallExpr.isCallExpression()) {
                        const [func] = loopCallExpr.node.arguments;
                        let indexId = null;
                        if (t.isFunctionExpression(func) || t.isArrowFunctionExpression(func)) {
                            const params = func.params;
                            indexId = params[1];
                        }
                        if (indexId === null || !t.isIdentifier(indexId)) {
                            throw utils_1.codeFrameError(path.node, '在循环中使用 ref 必须暴露循环的第二个参数 `index`');
                        }
                        attrs.push(t.jSXAttribute(t.jSXIdentifier('id'), t.jSXExpressionContainer(t.binaryExpression('+', t.stringLiteral(id), indexId))));
                    }
                    else {
                        attrs.push(t.jSXAttribute(t.jSXIdentifier('id'), t.stringLiteral(id)));
                    }
                }
                else {
                    const idValue = idAttr.value;
                    if (t.isStringLiteral(idValue)) {
                        id = idValue.value;
                    }
                    else if (t.isJSXExpressionContainer(idValue)) {
                        if (t.isStringLiteral(idValue.expression)) {
                            id = idValue.expression.value;
                        }
                        else {
                            idExpr = idValue.expression;
                        }
                    }
                }
                if (t.isStringLiteral(refAttr.value)) {
                    if (loopCallExpr) {
                        throw utils_1.codeFrameError(refAttr, '循环中的 ref 只能使用函数。');
                    }
                    this.createStringRef(componentName, id, refAttr.value.value);
                }
                if (t.isJSXExpressionContainer(refAttr.value)) {
                    const expr = refAttr.value.expression;
                    if (t.isStringLiteral(expr)) {
                        if (loopCallExpr) {
                            throw utils_1.codeFrameError(refAttr, '循环中的 ref 只能使用函数。');
                        }
                        this.createStringRef(componentName, id, expr.value);
                    }
                    else if (t.isArrowFunctionExpression(expr) || t.isMemberExpression(expr)) {
                        const type = constant_1.DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component';
                        if (loopCallExpr) {
                            this.loopRefs.set(path.parentPath.node, {
                                id: idExpr || id,
                                fn: expr,
                                type,
                                component: path.parentPath
                            });
                        }
                        else {
                            this.refs.push({
                                type,
                                id,
                                fn: expr
                            });
                        }
                    }
                    else if (t.isIdentifier(expr)) {
                        const type = constant_1.DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component';
                        const binding = path.scope.getBinding(expr.name);
                        const decl = t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.thisExpression(), expr), expr));
                        if (binding) {
                            binding.path.parentPath.insertAfter(decl);
                        }
                        else {
                            path.getStatementParent().insertBefore(decl);
                        }
                        this.refs.push({
                            type,
                            id,
                            fn: t.memberExpression(t.thisExpression(), expr)
                        });
                    }
                    else {
                        throw utils_1.codeFrameError(refAttr, 'ref 仅支持传入字符串、匿名箭头函数和 class 中已声明的函数');
                    }
                }
                if ("alipay" /* alipay */ === adapter_1.Adapter.type) {
                    attrs.push(t.jSXAttribute(t.jSXIdentifier('onTaroCollectChilds'), t.jSXExpressionContainer(t.memberExpression(t.thisExpression(), t.identifier('$collectChilds')))));
                }
                for (const [index, attr] of attrs.entries()) {
                    if (attr === refAttr) {
                        attrs.splice(index, 1);
                    }
                }
            },
            ClassMethod(classMethodPath) {
                const node = classMethodPath.node;
                if (t.isIdentifier(node.key)) {
                    const methodName = node.key.name;
                    self.methods.set(methodName, classMethodPath);
                    if (methodName.startsWith('render')) {
                        if (!utils_1.isContainJSXElement(classMethodPath)) {
                            throw utils_1.codeFrameError(classMethodPath.node, '以 render 开头的类函数必须返回 JSX，否则会导致渲染失败。如果是为了渲染字符串，建议更名。\n' +
                                '以 VSCode 为例：右键点击选择方法名，点击 rename symbol（重命名符号），输入新方法名。');
                        }
                        hasRender = true;
                        self.renderJSX.set(methodName, classMethodPath);
                        self.refIdMap.set(classMethodPath, new Set([]));
                        classMethodPath.traverse({
                            ReturnStatement(returnPath) {
                                const arg = returnPath.node.argument;
                                const ifStem = returnPath.findParent(p => p.isIfStatement());
                                // tslint:disable-next-line: strict-type-predicates
                                if (ifStem && classMethodPath.node.body.body.some(s => s === ifStem.node) && ifStem.isIfStatement() && arg === null) {
                                    const consequent = ifStem.get('consequent');
                                    if (consequent.isBlockStatement() && consequent.node.body.includes(returnPath.node)) {
                                        returnPath.get('argument').replaceWith(t.nullLiteral());
                                    }
                                }
                            },
                            CallExpression: {
                                enter(callPath) {
                                    const callee = callPath.get('callee');
                                    const args = callPath.node.arguments;
                                    if (callee.isMemberExpression()) {
                                        const { object, property } = callee.node;
                                        if (t.isThisExpression(object) && t.isIdentifier(property) && property.name.startsWith('render')) {
                                            const propName = property.name;
                                            if (!self.methods.has(propName)) {
                                                const o = utils_1.getSuperClassPath(self.classPath);
                                                if (o) {
                                                    const p = o.resolvePath.endsWith('.js') ? o.resolvePath.slice(0, o.resolvePath.length - 3) : o.resolvePath;
                                                    self.importJSXs.add(`<import src="${p + '.wxml'}"/>`);
                                                }
                                            }
                                            self.renameJSXClassFunc(propName, methodName, callPath, args);
                                        }
                                    }
                                    if (callee.isIdentifier()) {
                                        const nodeName = callee.node.name;
                                        if (nodeName.startsWith('renderClosure')) {
                                            self.renameJSXClassFunc(nodeName, methodName, callPath, args, true);
                                        }
                                    }
                                },
                                exit(callPath) {
                                    const jsxExpr = callPath.parentPath;
                                    if (!jsxExpr.isJSXExpressionContainer()) {
                                        return;
                                    }
                                    const jsxAttr = jsxExpr.parentPath;
                                    if (!jsxAttr.isJSXAttribute()) {
                                        return;
                                    }
                                    const { name: attrName } = jsxAttr.node;
                                    if (!t.isJSXIdentifier(attrName, { name: 'data' })) {
                                        return;
                                    }
                                    utils_1.generateAnonymousState(callPath.scope, callPath, self.refIdMap.get(classMethodPath));
                                }
                            }
                        });
                    }
                    if (methodName.startsWith('render')) {
                        self.renderJSX.set(methodName, classMethodPath);
                        self.refIdMap.set(classMethodPath, new Set([]));
                    }
                    if (methodName === 'constructor') {
                        classMethodPath.traverse({
                            AssignmentExpression(p) {
                                if (t.isMemberExpression(p.node.left) &&
                                    t.isThisExpression(p.node.left.object) &&
                                    t.isIdentifier(p.node.left.property) &&
                                    p.node.left.property.name === 'state' &&
                                    t.isObjectExpression(p.node.right)) {
                                    const properties = p.node.right.properties;
                                    properties.forEach(p => {
                                        if (t.isObjectProperty(p) && t.isIdentifier(p.key)) {
                                            self.initState.add(p.key.name);
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
            },
            ClassBody: {
                exit(path) {
                    const node = path.node;
                    if (!hasRender) {
                        node.body.push(t.classMethod('method', t.identifier('_createData'), [], t.blockStatement([])));
                    }
                }
            },
            IfStatement: (path) => {
                const test = path.get('test');
                const consequent = path.get('consequent');
                if (utils_1.isContainJSXElement(consequent) && utils_1.hasComplexExpression(test)) {
                    this.renderJSX.forEach(method => {
                        const renderMethod = path.findParent(p => method === p);
                        if (renderMethod && renderMethod.isClassMethod()) {
                            const scope = renderMethod && renderMethod.scope || path.scope;
                            utils_1.generateAnonymousState(scope, test, this.refIdMap.get(renderMethod), true);
                        }
                    });
                }
            },
            ClassProperty(path) {
                const { key: { name }, value } = path.node;
                if (t.isArrowFunctionExpression(value) || t.isFunctionExpression(value)) {
                    self.methods.set(name, path);
                    if (name.startsWith('render')) {
                        path.replaceWith(t.classMethod('method', t.identifier(name), value.params, t.isBlockStatement(value.body) ? value.body : t.blockStatement([
                            t.returnStatement(value.body)
                        ])));
                    }
                }
                if (name === 'state' && t.isObjectExpression(value)) {
                    value.properties.forEach(p => {
                        if (t.isObjectProperty(p)) {
                            if (t.isIdentifier(p.key)) {
                                self.initState.add(p.key.name);
                            }
                        }
                    });
                }
            },
            JSXExpressionContainer(path) {
                const attr = path.findParent(p => p.isJSXAttribute());
                if (!attr) {
                    const expr = path.get('expression');
                    if (expr.isBooleanLiteral() || expr.isNullLiteral()) {
                        path.remove();
                        return;
                    }
                }
                const isFunctionProp = attr && typeof attr.node.name.name === 'string' && attr.node.name.name.startsWith('on');
                let renderMethod;
                self.renderJSX.forEach(method => {
                    renderMethod = path.findParent(p => method === p);
                });
                const jsxReferencedIdentifiers = self.refIdMap.get(renderMethod);
                path.traverse({
                    MemberExpression(path) {
                        const sibling = path.getSibling('property');
                        if (path.get('object').isThisExpression() &&
                            (path.get('property').isIdentifier({ name: 'props' }) || path.get('property').isIdentifier({ name: 'state' })) &&
                            sibling.isIdentifier()) {
                            if (!isFunctionProp) {
                                self.usedState.add(sibling.node.name);
                            }
                        }
                    }
                });
                const expression = path.get('expression');
                const scope = renderMethod && renderMethod.scope || path.scope;
                const calleeExpr = expression.get('callee');
                const parentPath = path.parentPath;
                if (utils_1.hasComplexExpression(expression) &&
                    !isFunctionProp &&
                    !(calleeExpr &&
                        calleeExpr.isMemberExpression() &&
                        calleeExpr.get('object').isMemberExpression() &&
                        calleeExpr.get('property').isIdentifier({ name: 'bind' })) // is not bind
                ) {
                    const calleeName = calleeExpr.isIdentifier() && calleeExpr.node.name;
                    if (typeof calleeName === 'string' && calleeName.startsWith('render') && utils_1.isDerivedFromProps(calleeExpr.scope, calleeName)) {
                        return;
                    }
                    if (calleeExpr.isMemberExpression() && utils_1.isDerivedFromProps(calleeExpr.scope, utils_1.findFirstIdentifierFromMemberExpression(calleeExpr.node).name)) {
                        const idName = utils_1.findFirstIdentifierFromMemberExpression(calleeExpr.node).name;
                        if (utils_1.isDerivedFromProps(calleeExpr.scope, idName) && t.isIdentifier(calleeExpr.node.property) && calleeExpr.node.property.name.startsWith('render')) {
                            return;
                        }
                    }
                    utils_1.generateAnonymousState(scope, expression, jsxReferencedIdentifiers);
                }
                else {
                    if (parentPath.isJSXAttribute()) {
                        if (!(expression.isMemberExpression() || expression.isIdentifier()) && parentPath.node.name.name === 'key') {
                            utils_1.generateAnonymousState(scope, expression, jsxReferencedIdentifiers);
                        }
                    }
                }
                if (!attr)
                    return;
                const key = attr.node.name;
                const value = attr.node.value;
                if (!t.isJSXIdentifier(key)) {
                    return;
                }
                const jsx = path.findParent(p => p.isJSXOpeningElement());
                if (t.isJSXIdentifier(key) && key.name.startsWith('on') && t.isJSXExpressionContainer(value)) {
                    const expr = value.expression;
                    if (t.isCallExpression(expr) &&
                        t.isMemberExpression(expr.callee) &&
                        t.isIdentifier(expr.callee.property, { name: 'bind' }) &&
                        !functional_1.Status.isSFC) {
                        if ((!adapter_1.isNewPropsSystem()) ||
                            (t.isJSXIdentifier(jsx.node.name) && constant_1.DEFAULT_Component_SET.has(jsx.node.name.name))) {
                            self.buildPropsAnonymousFunc(attr, expr, true, path);
                        }
                    }
                    else if (t.isMemberExpression(expr)) {
                        if ((!adapter_1.isNewPropsSystem()) ||
                            (t.isJSXIdentifier(jsx.node.name) && constant_1.DEFAULT_Component_SET.has(jsx.node.name.name))) {
                            self.buildPropsAnonymousFunc(attr, expr, false, path);
                        }
                    }
                    else if (!t.isLiteral(expr)) {
                        self.buildAnonyMousFunc(path, attr, expr);
                    }
                    else {
                        throw utils_1.codeFrameError(path.node, '组件事件传参不能传入基本类型');
                    }
                }
                if (!jsx)
                    return;
                const jsxName = jsx.node.name;
                if (!t.isJSXIdentifier(jsxName))
                    return;
                if (expression.isJSXElement())
                    return;
                if (constant_1.DEFAULT_Component_SET.has(jsxName.name) || expression.isIdentifier() || expression.isMemberExpression() || expression.isLiteral() || expression.isLogicalExpression() || expression.isConditionalExpression() || key.name.startsWith('on') || expression.isCallExpression())
                    return;
                if (utils_1.isContainJSXElement(path))
                    return;
                utils_1.generateAnonymousState(scope, expression, jsxReferencedIdentifiers);
            },
            Identifier(path) {
                const isStartWithRender = /^render[A-Z]/.test(path.node.name);
                const isInJSXExprContainer = !!path.findParent(p => p.isJSXExpressionContainer());
                if (!isInJSXExprContainer) {
                    return;
                }
                if (path.node.name === 'children' || isStartWithRender) {
                    const parentPath = path.parentPath;
                    const slot = t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('slot'), [], true), t.jSXClosingElement(t.jSXIdentifier('slot')), [], true);
                    if (isStartWithRender) {
                        slot.openingElement.attributes.push(t.jSXAttribute(t.jSXIdentifier('name'), t.stringLiteral(utils_1.getSlotName(path.node.name))));
                        self.setMultipleSlots();
                    }
                    if (parentPath.isCallExpression() && parentPath.parentPath.isJSXExpressionContainer()) {
                        if (utils_1.isDerivedFromProps(path.scope, path.node.name)) {
                            render_props_1.injectRenderPropsEmiter(parentPath, path.node.name);
                            parentPath.replaceWith(slot);
                        }
                    }
                    if (parentPath.isMemberExpression() && parentPath.parentPath.isCallExpression()) {
                        if (utils_1.isDerivedFromProps(path.scope, utils_1.findFirstIdentifierFromMemberExpression(parentPath.node).name)) {
                            render_props_1.injectRenderPropsEmiter(parentPath.parentPath, path.node.name);
                            parentPath.parentPath.replaceWith(slot);
                        }
                    }
                    if (parentPath.isMemberExpression() &&
                        parentPath.isReferenced() &&
                        (parentPath.parentPath.isJSXExpressionContainer() ||
                            parentPath.parentPath.isLogicalExpression() ||
                            parentPath.parentPath.isConditionalExpression())) {
                        const object = parentPath.get('object');
                        if (object.isIdentifier()) {
                            const objectName = object.node.name;
                            if (utils_1.isDerivedFromProps(path.scope, objectName)) {
                                parentPath.replaceWith(slot);
                            }
                        }
                    }
                    else if (path.isReferencedIdentifier()) {
                        if (utils_1.isDerivedFromProps(path.scope, 'children')) {
                            parentPath.replaceWith(slot);
                        }
                    }
                }
            },
            JSXElement(path) {
                const id = path.node.openingElement.name;
                if (t.isJSXIdentifier(id) &&
                    !constant_1.DEFAULT_Component_SET.has(id.name)) {
                    if (self.moduleNames.indexOf(id.name) !== -1) {
                        const name = id.name;
                        const binding = self.classPath.scope.getBinding(name);
                        if (binding && t.isImportDeclaration(binding.path.parent)) {
                            const sourcePath = binding.path.parent.source.value;
                            const specs = binding.path.parent.specifiers.filter(s => t.isImportSpecifier(s));
                            if (binding.path.isImportDefaultSpecifier()) {
                                self.customComponents.set(name, {
                                    sourcePath,
                                    type: 'default'
                                });
                            }
                            else {
                                const spec = specs.find(s => s.local.name === name && s.imported.name !== name);
                                if (spec) {
                                    self.customComponents.set(name, {
                                        sourcePath,
                                        type: 'pattern',
                                        imported: spec.imported.name
                                    });
                                }
                                else {
                                    self.customComponents.set(name, {
                                        sourcePath,
                                        type: 'pattern'
                                    });
                                }
                            }
                        }
                    }
                    if (id.name.endsWith(constant_1.CONTEXT_PROVIDER)) {
                        const valueAttr = path.node.openingElement.attributes.find(a => t.isJSXIdentifier(a.name) && a.name.name === 'value');
                        const contextName = id.name.slice(0, id.name.length - constant_1.CONTEXT_PROVIDER.length);
                        if (valueAttr) {
                            if (t.isJSXElement(valueAttr.value)) {
                                throw utils_1.codeFrameError(valueAttr.value, 'Provider 的 value 只能传入一个字符串或普通表达式，不能传入 JSX');
                            }
                            else {
                                const value = t.isStringLiteral(valueAttr.value) ? valueAttr.value : valueAttr.value.expression;
                                const expr = t.expressionStatement(t.callExpression(t.memberExpression(t.identifier(contextName), t.identifier('Provider')), [value]));
                                path.getStatementParent().insertBefore(expr);
                                path.replaceWith(t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('Block'), []), t.jSXClosingElement(t.jSXIdentifier('Block')), path.node.children));
                            }
                        }
                    }
                }
            },
            MemberExpression: (path) => {
                const object = path.get('object');
                const property = path.get('property');
                if (!(object.isThisExpression() && property.isIdentifier({ name: 'props' }))) {
                    return;
                }
                const parentPath = path.parentPath;
                if (parentPath.isMemberExpression()) {
                    const siblingProp = parentPath.get('property');
                    if (siblingProp.isIdentifier()) {
                        const name = siblingProp.node.name;
                        if (name === 'children') {
                            parentPath.replaceWith(t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('slot'), [], true), t.jSXClosingElement(t.jSXIdentifier('slot')), [], true));
                        }
                        else if (/^render[A-Z]/.test(name)) {
                            const slotName = utils_1.getSlotName(name);
                            if (parentPath.parentPath.isCallExpression()) {
                                render_props_1.injectRenderPropsEmiter(parentPath.parentPath, name);
                                parentPath.parentPath.replaceWith(t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('slot'), [
                                    t.jSXAttribute(t.jSXIdentifier('name'), t.stringLiteral(slotName))
                                ], true), t.jSXClosingElement(t.jSXIdentifier('slot')), []));
                            }
                            else {
                                parentPath.replaceWith(t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('slot'), [
                                    t.jSXAttribute(t.jSXIdentifier('name'), t.stringLiteral(slotName))
                                ], true), t.jSXClosingElement(t.jSXIdentifier('slot')), []));
                            }
                            this.setMultipleSlots();
                        }
                        else {
                            self.componentProperies.add(siblingProp.node.name);
                        }
                    }
                }
                else if (parentPath.isVariableDeclarator()) {
                    const siblingId = parentPath.get('id');
                    if (siblingId.isObjectPattern()) {
                        const properties = siblingId.node.properties;
                        for (const prop of properties) {
                            if (t.isRestProperty(prop)) {
                                throw utils_1.codeFrameError(prop.loc, 'this.props 不支持使用 rest property 语法，请把每一个 prop 都单独列出来');
                            }
                            else if (t.isIdentifier(prop.key)) {
                                self.componentProperies.add(prop.key.name);
                            }
                        }
                    }
                }
            },
            CallExpression(path) {
                const node = path.node;
                const callee = node.callee;
                if (t.isMemberExpression(callee) && t.isMemberExpression(callee.object)) {
                    const property = callee.property;
                    if (t.isIdentifier(property)) {
                        if (property.name.startsWith('on')) {
                            self.componentProperies.add(`${constant_1.FN_PREFIX}${property.name}`);
                            processThisPropsFnMemberProperties(callee, path, node.arguments);
                        }
                        else if (property.name === 'call' || property.name === 'apply') {
                            self.componentProperies.add(`${constant_1.FN_PREFIX}${property.name}`);
                            processThisPropsFnMemberProperties(callee.object, path, node.arguments);
                        }
                    }
                }
            }
        });
    }
    setComponents() {
        const components = [];
        this.customComponents.forEach((component, name) => {
            if (name.startsWith('Taro') && component.sourcePath === constant_1.COMPONENTS_PACKAGE_NAME) {
                return;
            }
            if (adapter_1.Adapter.type === "quickapp" /* quickapp */ && constant_1.DEFAULT_Component_SET_COPY.has(name)) {
                return;
            }
            components.push(name);
            this.result.components.push({
                path: utils_1.pathResolver(component.sourcePath, this.sourcePath),
                name: component.imported ? lodash_1.kebabCase(name) + '|' + lodash_1.kebabCase(component.imported) : lodash_1.kebabCase(name),
                type: component.type
            });
        });
        this.classPath.node.body.body.push(t.classProperty(t.identifier('customComponents'), t.arrayExpression(components.map(c => t.stringLiteral(c)))));
    }
    setMethods() {
        const methods = this.classPath.get('body').get('body');
        for (const method of methods) {
            if (method.isClassMethod()) {
                const key = method.get('key');
                if (key.isIdentifier()) {
                    this.methods.set(key.node.name, method);
                }
            }
        }
    }
    resetConstructor() {
        const body = this.classPath.node.body.body;
        if (!this.methods.has('constructor')) {
            const ctor = buildConstructor();
            body.unshift(ctor);
        }
        if (env_1.isTestEnv) {
            return;
        }
        for (const method of body) {
            if (t.isClassMethod(method) && method.kind === 'constructor') {
                method.kind = 'method';
                method.key = t.identifier('_constructor');
                if (t.isBlockStatement(method.body)) {
                    for (const statement of method.body.body) {
                        if (t.isExpressionStatement(statement)) {
                            const expr = statement.expression;
                            if (t.isCallExpression(expr) && (t.isIdentifier(expr.callee, { name: 'super' }) || t.isSuper(expr.callee))) {
                                expr.callee = t.memberExpression(t.identifier('super'), t.identifier('_constructor'));
                            }
                        }
                    }
                }
            }
        }
    }
    handleLifecyclePropParam(propParam, properties) {
        let propsName = null;
        if (!propParam) {
            return null;
        }
        if (t.isIdentifier(propParam)) {
            propsName = propParam.name;
        }
        else if (t.isObjectPattern(propParam)) {
            for (const prop of propParam.properties) {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                    properties.add(prop.key.name);
                }
                else if (t.isRestProperty(prop) && t.isIdentifier(prop.argument)) {
                    propsName = prop.argument.name;
                }
            }
        }
        else {
            throw utils_1.codeFrameError(propParam.loc, '此生命周期的第一个参数只支持写标识符或对象解构');
        }
        return propsName;
    }
    findMoreProps() {
        // 第一个参数是 props 的生命周期
        const lifeCycles = new Set([
            // 'constructor',
            'componentDidUpdate',
            'shouldComponentUpdate',
            'getDerivedStateFromProps',
            'getSnapshotBeforeUpdate',
            'componentWillReceiveProps',
            'componentWillUpdate'
        ]);
        const properties = new Set();
        this.methods.forEach((method, name) => {
            if (!lifeCycles.has(name)) {
                return;
            }
            const node = method.node;
            let propsName = null;
            if (t.isClassMethod(node)) {
                propsName = this.handleLifecyclePropParam(node.params[0], properties);
            }
            else if (t.isArrowFunctionExpression(node.value) || t.isFunctionExpression(node.value)) {
                propsName = this.handleLifecyclePropParam(node.value.params[0], properties);
            }
            if (propsName === null) {
                return;
            }
            method.traverse({
                MemberExpression(path) {
                    if (!path.isReferencedMemberExpression()) {
                        return;
                    }
                    const { object, property } = path.node;
                    if (t.isIdentifier(object, { name: propsName }) && t.isIdentifier(property)) {
                        properties.add(property.name);
                    }
                },
                VariableDeclarator(path) {
                    const { id, init } = path.node;
                    if (t.isObjectPattern(id) && t.isIdentifier(init, { name: propsName })) {
                        for (const prop of id.properties) {
                            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                                properties.add(prop.key.name);
                            }
                        }
                    }
                }
            });
            properties.forEach((value) => {
                this.componentProperies.add(value);
            });
        });
    }
    parseRender() {
        if (this.importJSXs.size) {
            this.importJSXs.forEach(s => {
                this.result.template += s + '\n';
            });
        }
        if (this.renderJSX.size) {
            this.renderJSX.forEach((method, methodName) => {
                this.result.template = this.result.template
                    + new render_1.RenderParser(method, this.methods, this.initState, this.refIdMap.get(method), this.usedState, this.customComponentNames, this.componentProperies, this.loopRefs, this.refObjExpr, methodName).outputTemplate + '\n';
            });
        }
        else {
            throw utils_1.codeFrameError(this.classPath.node.loc, '没有定义 render 方法');
        }
    }
    clearClosureMethods() {
        this.classPath.node.body.body = this.classPath.node.body.body.filter(m => {
            if (m && t.isClassMethod(m) && t.isIdentifier(m.key) && m.key.name.startsWith('_createClosure')) {
                return false;
            }
            return true;
        });
    }
    compile() {
        this.traverse();
        this.setMethods();
        this.setComponents();
        this.resetConstructor();
        this.findMoreProps();
        this.handleRefs();
        this.parseRender();
        this.setComponentPath();
        this.clearClosureMethods();
        this.result.componentProperies = [...this.componentProperies];
    }
}
exports.Transformer = Transformer;
//# sourceMappingURL=class.js.map