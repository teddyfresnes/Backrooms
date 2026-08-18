import type { Object3D } from 'three'
import type { HumanoidBoneMap } from '../core/types'

const ALIASES: Record<keyof HumanoidBoneMap, string[]> = {
  hips: ['hips', 'mixamorighips', 'pelvis'],
  spine: ['spine', 'mixamorigspine'],
  chest: ['chest', 'spine1', 'spine2', 'mixamorigspine1', 'mixamorigspine2'],
  neck: ['neck', 'mixamorigneck'],
  head: ['head', 'mixamorighead'],
  leftShoulder: ['leftshoulder', 'shoulder_l', 'mixamorigleftshoulder'],
  rightShoulder: ['rightshoulder', 'shoulder_r', 'mixamorigrightshoulder'],
  leftUpperArm: ['leftarm', 'upperarm_l', 'mixamorigleftarm'],
  rightUpperArm: ['rightarm', 'upperarm_r', 'mixamorigrightarm'],
  leftForeArm: ['leftforearm', 'forearm_l', 'mixamorigleftforearm'],
  rightForeArm: ['rightforearm', 'forearm_r', 'mixamorigrightforearm'],
  leftHand: ['lefthand', 'hand_l', 'mixamoriglefthand'],
  rightHand: ['righthand', 'hand_r', 'mixamorigrighthand'],
  leftUpperLeg: ['leftupleg', 'thigh_l', 'mixamorigleftupleg'],
  rightUpperLeg: ['rightupleg', 'thigh_r', 'mixamorigrightupleg'],
  leftLowerLeg: ['leftleg', 'shin_l', 'mixamorigleftleg'],
  rightLowerLeg: ['rightleg', 'shin_r', 'mixamorigrightleg'],
  leftFoot: ['leftfoot', 'foot_l', 'mixamorigleftfoot'],
  rightFoot: ['rightfoot', 'foot_r', 'mixamorigrightfoot'],
}

function normalized(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export class HumanoidRig {
  readonly root: Object3D
  readonly bones: HumanoidBoneMap
  private readonly byName = new Map<string, Object3D>()

  constructor(root: Object3D) {
    this.root = root
    root.traverse((node) => this.byName.set(normalized(node.name), node))
    this.bones = Object.fromEntries(
      Object.entries(ALIASES).map(([key, aliases]) => [
        key,
        aliases.map(normalized).map((alias) => this.byName.get(alias)).find(Boolean),
      ]),
    ) as HumanoidBoneMap
  }

  findBone(name: string) {
    return this.byName.get(normalized(name)) ?? Object.values(this.bones).find((bone) => bone && normalized(bone.name) === normalized(name))
  }

  get coverage() {
    const values = Object.values(this.bones)
    return values.filter(Boolean).length / values.length
  }
}
