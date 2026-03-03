/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Group, Matrix4 } from 'three';

export class XROrigin extends Group {
  public readonly head: Group;

  public readonly raySpaces = {
    left: new Group(),
    right: new Group(),
  };

  public readonly gripSpaces = {
    left: new Group(),
    right: new Group(),
  };

  public readonly secondaryRaySpaces = {
    left: new Group(),
    right: new Group(),
  };

  public readonly secondaryGripSpaces = {
    left: new Group(),
    right: new Group(),
  };

  /**
   * Spaces representing the index finger tip positions for each hand.
   * Used by TouchPointer for poke interactions.
   * Updated from hand tracking joint data when hands are active.
   * Falls back to raySpaces when controllers are used.
   */
  public readonly indexTipSpaces = {
    left: new Group(),
    right: new Group(),
  };

  private headsetMatrix = new Matrix4();

  constructor() {
    super();

    this.head = new Group();
    this.head.name = 'xr-origin-head';
    this.add(
      this.head,
      this.raySpaces.left,
      this.raySpaces.right,
      this.gripSpaces.left,
      this.gripSpaces.right,
      this.indexTipSpaces.left,
      this.indexTipSpaces.right,
    );
  }

  updateHead(frame: XRFrame, referenceSpace: XRReferenceSpace): void {
    const pose = frame.getViewerPose(referenceSpace);
    if (pose) {
      this.headsetMatrix.fromArray(pose.transform.matrix);
      this.headsetMatrix.decompose(
        this.head.position,
        this.head.quaternion,
        this.head.scale,
      );
    }
  }
}
