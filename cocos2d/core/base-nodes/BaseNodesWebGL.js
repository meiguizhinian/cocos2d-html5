/****************************************************************************
 Copyright (c) 2010-2012 cocos2d-x.org
 Copyright (c) 2008-2010 Ricardo Quesada
 Copyright (c) 2011      Zynga Inc.

 http://www.cocos2d-x.org

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 ****************************************************************************/

if (cc._renderType === cc._RENDER_TYPE_WEBGL) {
    /**
     * CCNode
     * @type {Object|Function|cc.Node|*}
     * @private
     */
    var _p = cc.Node.prototype;

    _p._transform4x4 = null;
    _p._stackMatrix = null;
    _p._glServerState = null;
    _p._camera = null;

    _p.ctor = function () {
        var _t = this;
        _t._initNode();

        //WebGL
        var mat4 = new cc.kmMat4();
        mat4.mat[2] = mat4.mat[3] = mat4.mat[6] = mat4.mat[7] = mat4.mat[8] = mat4.mat[9] = mat4.mat[11] = mat4.mat[14] = 0.0;
        mat4.mat[10] = mat4.mat[15] = 1.0;
        _t._transform4x4 = mat4;
        _t._glServerState = 0;
        _t._stackMatrix = new cc.kmMat4();
    };

    _p.setNodeDirty = function () {
        this._transformDirty === false && (this._transformDirty = this._inverseDirty = true);
    };

    _p.visit = function(){
        var _t = this;
        // quick return if not visible
        if (!_t._visible)
            return;
        var context = cc._renderContext, i, currentStack = cc.current_stack;

        //cc.kmGLPushMatrixWitMat4(_t._stackMatrix);
        //optimize performance for javascript
        currentStack.stack.push(currentStack.top);
        cc.kmMat4Assign(_t._stackMatrix, currentStack.top);
        currentStack.top = _t._stackMatrix;

        var locGrid = _t.grid;
        if (locGrid && locGrid._active)
            locGrid.beforeDraw();

        _t.transform();

        var locChildren = _t._children;
        if (locChildren && locChildren.length > 0) {
            var childLen = locChildren.length;
            _t.sortAllChildren();
            // draw children zOrder < 0
            for (i = 0; i < childLen; i++) {
                if (locChildren[i] && locChildren[i]._localZOrder < 0)
                    locChildren[i].visit();
                else
                    break;
            }
            _t.draw(context);
            // draw children zOrder >= 0
            for (; i < childLen; i++) {
                if (locChildren[i]) {
                    locChildren[i].visit();
                }
            }
        } else
            _t.draw(context);

        _t.arrivalOrder = 0;
        if (locGrid && locGrid._active)
            locGrid.afterDraw(_t);

        //cc.kmGLPopMatrix();
        //optimize performance for javascript
        currentStack.top = currentStack.stack.pop();
    };

    _p.transform = function () {
        var _t = this;
        //optimize performance for javascript
        var t4x4 = _t._transform4x4,  topMat4 = cc.current_stack.top;

        // Convert 3x3 into 4x4 matrix
        //cc.CGAffineToGL(_t.nodeToParentTransform(), _t._transform4x4.mat);
        var trans = _t.nodeToParentTransform();
        var t4x4Mat = t4x4.mat;
        t4x4Mat[0] = trans.a;
        t4x4Mat[4] = trans.c;
        t4x4Mat[12] = trans.tx;
        t4x4Mat[1] = trans.b;
        t4x4Mat[5] = trans.d;
        t4x4Mat[13] = trans.ty;

        // Update Z vertex manually
        //_t._transform4x4.mat[14] = _t._vertexZ;
        t4x4Mat[14] = _t._vertexZ;

        //optimize performance for Javascript
        cc.kmMat4Multiply(topMat4, topMat4, t4x4); // = cc.kmGLMultMatrix(_t._transform4x4);

        // XXX: Expensive calls. Camera should be integrated into the cached affine matrix
        if (_t._camera != null && !(_t.grid != null && _t.grid.isActive())) {
            var apx = _t._anchorPointInPoints.x, apy = _t._anchorPointInPoints.y;
            var translate = (apx !== 0.0 || apy !== 0.0);
            if (translate){
                if(!cc.SPRITEBATCHNODE_RENDER_SUBPIXEL) {
                    apx = 0 | apx;
                    apy = 0 | apy;
                }
                cc.kmGLTranslatef(apx, apy, 0);
                _t._camera.locate();
                cc.kmGLTranslatef(-apx, -apy, 0);
            } else {
                _t._camera.locate();
            }
        }
    };

    _p.nodeToParentTransform = function () {
        var _t = this;
        if (_t._transformDirty) {
            // Translate values
            var x = _t._position.x;
            var y = _t._position.y;
            var apx = _t._anchorPointInPoints.x, napx = -apx;
            var apy = _t._anchorPointInPoints.y, napy = -apy;
            var scx = _t._scaleX, scy = _t._scaleY;

            if (_t._ignoreAnchorPointForPosition) {
                x += apx;
                y += apy;
            }

            // Rotation values
            // Change rotation code to handle X and Y
            // If we skew with the exact same value for both x and y then we're simply just rotating
            var cx = 1, sx = 0, cy = 1, sy = 0;
            if (_t._rotationX !== 0 || _t._rotationY !== 0) {
                cx = Math.cos(-_t._rotationRadiansX);
                sx = Math.sin(-_t._rotationRadiansX);
                cy = Math.cos(-_t._rotationRadiansY);
                sy = Math.sin(-_t._rotationRadiansY);
            }
            var needsSkewMatrix = ( _t._skewX || _t._skewY );

            // optimization:
            // inline anchor point calculation if skew is not needed
            // Adjusted transform calculation for rotational skew
            if (!needsSkewMatrix && (apx !== 0 || apy !== 0)) {
                x += cy * napx * scx + -sx * napy * scy;
                y += sy * napx * scx + cx * napy * scy;
            }

            // Build Transform Matrix
            // Adjusted transform calculation for rotational skew
            var t = _t._transform;
            t.a = cy * scx;
            t.b = sy * scx;
            t.c = -sx * scy;
            t.d = cx * scy;
            t.tx = x;
            t.ty = y;

            // XXX: Try to inline skew
            // If skew is needed, apply skew and then anchor point
            if (needsSkewMatrix) {
                t = cc.AffineTransformConcat({a: 1.0, b: Math.tan(cc.degreesToRadians(_t._skewY)),
                    c: Math.tan(cc.degreesToRadians(_t._skewX)), d: 1.0, tx: 0.0, ty: 0.0}, t);

                // adjust anchor point
                if (apx !== 0 || apy !== 0)
                    t = cc.AffineTransformTranslate(t, napx, napy);
            }

            if (_t._additionalTransformDirty) {
                t = cc.AffineTransformConcat(t, _t._additionalTransform);
                _t._additionalTransformDirty = false;
            }
            _t._transform = t;
            _t._transformDirty = false;
        }
        return _t._transform;
    };

    delete _p;

}