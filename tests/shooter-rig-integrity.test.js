import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetPath = (id) => path.join(root, 'assets', 'generated', '3d', 'shooter', `${id}.glb`);

const ACCESSOR_WIDTH = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
});

const COMPONENTS = Object.freeze({
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset), normalize: (value) => Math.max(value / 127, -1) },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset), normalize: (value) => value / 255 },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true), normalize: (value) => Math.max(value / 32767, -1) },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true), normalize: (value) => value / 65535 },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true), normalize: (value) => value / 4294967295 },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true), normalize: (value) => value },
});

async function readGlb(id) {
  const bytes = await readFile(assetPath(id));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);

  let document;
  let binary;
  let offset = 12;
  while (offset < bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    assert.ok(chunkEnd <= bytes.length, `${id}: truncated GLB chunk`);
    if (chunkType === 0x4e4f534a) {
      document = JSON.parse(bytes.toString('utf8', chunkStart, chunkEnd).trimEnd());
    } else if (chunkType === 0x004e4942) {
      binary = bytes.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd;
  }
  assert.ok(document, `${id}: JSON chunk missing`);
  assert.ok(binary, `${id}: binary chunk missing`);
  return { document, binary };
}

function decodeAccessor(document, binary, accessorIndex, context) {
  const accessor = document.accessors?.[accessorIndex];
  assert.ok(accessor, `${context}: accessor ${accessorIndex} missing`);
  assert.equal(accessor.sparse, undefined, `${context}: sparse accessors are outside the runtime contract`);
  assert.ok(Number.isInteger(accessor.bufferView), `${context}: dense bufferView missing`);

  const bufferView = document.bufferViews?.[accessor.bufferView];
  assert.ok(bufferView, `${context}: bufferView ${accessor.bufferView} missing`);
  assert.equal(bufferView.buffer ?? 0, 0, `${context}: GLB accessor must use buffer 0`);
  const component = COMPONENTS[accessor.componentType];
  const width = ACCESSOR_WIDTH[accessor.type];
  assert.ok(component, `${context}: unsupported component type ${accessor.componentType}`);
  assert.ok(width, `${context}: unsupported accessor type ${accessor.type}`);

  const packedStride = component.bytes * width;
  const stride = bufferView.byteStride ?? packedStride;
  assert.ok(stride >= packedStride, `${context}: byteStride is too small`);
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const lastByte = start + Math.max(0, accessor.count - 1) * stride + packedStride;
  assert.ok(lastByte <= binary.length, `${context}: accessor data exceeds the GLB binary chunk`);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);

  return Array.from({ length: accessor.count }, (_, row) => (
    Array.from({ length: width }, (_, column) => {
      const value = component.read(view, start + row * stride + column * component.bytes);
      return accessor.normalized ? component.normalize(value) : value;
    })
  ));
}

function keyframeValues(values, interpolation) {
  if (interpolation !== 'CUBICSPLINE') return values;
  return values.filter((_, index) => index % 3 === 1);
}

function tuplesDiffer(values, epsilon = 1e-6) {
  const first = values[0];
  return values.slice(1).some((tuple) => (
    tuple.some((value, index) => Math.abs(value - first[index]) > epsilon)
  ));
}

const RIGS = [
  {
    id: 'ice-peashooter',
    armature: 'IcePeashooter_Armature',
    rootJoint: 'Root',
    clips: ['Hit', 'Idle', 'Move', 'Shoot'],
    minJoints: 8,
  },
  {
    id: 'garden-ghoul',
    armature: 'GardenGhoul_Armature',
    rootJoint: 'Root',
    clips: ['Ghoul_Hit', 'Ghoul_Hop', 'Ghoul_Idle'],
    minJoints: 8,
  },
];

for (const rig of RIGS) {
  test(`${rig.id} has numerically valid skinning and non-root bone animation`, async () => {
    const { document, binary } = await readGlb(rig.id);
    const nodes = document.nodes ?? [];
    const skins = document.skins ?? [];
    assert.ok(nodes.some((node) => node.name === rig.armature), `${rig.id}: armature node missing`);
    assert.ok(skins.length > 0, `${rig.id}: glTF skin missing`);

    const allJointIndices = new Set();
    const rootJointIndices = new Set();
    for (const [skinIndex, skin] of skins.entries()) {
      assert.ok(skin.joints.length >= rig.minJoints, `${rig.id}: skin ${skinIndex} has too few joints`);
      assert.equal(new Set(skin.joints).size, skin.joints.length, `${rig.id}: skin joints must be unique`);
      for (const jointIndex of skin.joints) {
        assert.ok(Number.isInteger(jointIndex) && nodes[jointIndex], `${rig.id}: invalid joint node index`);
        allJointIndices.add(jointIndex);
        if (nodes[jointIndex].name === rig.rootJoint) rootJointIndices.add(jointIndex);
      }
      assert.ok(Number.isInteger(skin.inverseBindMatrices), `${rig.id}: inverse bind matrices missing`);
      const inverseBindAccessor = document.accessors[skin.inverseBindMatrices];
      assert.equal(inverseBindAccessor.componentType, 5126, `${rig.id}: inverse bind matrices must be FLOAT`);
      assert.equal(inverseBindAccessor.type, 'MAT4', `${rig.id}: inverse bind matrices must be MAT4`);
      assert.equal(inverseBindAccessor.count, skin.joints.length, `${rig.id}: inverse bind count must match joints`);
      const inverseBindValues = decodeAccessor(
        document,
        binary,
        skin.inverseBindMatrices,
        `${rig.id} inverse bind matrices`,
      );
      assert.ok(inverseBindValues.flat().every(Number.isFinite), `${rig.id}: inverse bind matrices must be finite`);
      assert.ok(inverseBindValues.every((matrix) => matrix.some((value) => Math.abs(value) > 1e-8)), `${rig.id}: zero inverse bind matrix`);
    }
    assert.ok(rootJointIndices.size > 0, `${rig.id}: ${rig.rootJoint} is not a skin joint`);

    let skinnedPrimitiveCount = 0;
    let weightedVertexCount = 0;
    const usedJointIndices = new Set();
    for (const [nodeIndex, node] of nodes.entries()) {
      if (!Number.isInteger(node.skin)) continue;
      const skin = skins[node.skin];
      assert.ok(skin, `${rig.id}: node ${nodeIndex} references an invalid skin`);
      assert.ok(Number.isInteger(node.mesh), `${rig.id}: skinned node ${nodeIndex} has no mesh`);
      for (const [primitiveIndex, primitive] of document.meshes[node.mesh].primitives.entries()) {
        const context = `${rig.id} node ${nodeIndex} primitive ${primitiveIndex}`;
        const positionIndex = primitive.attributes?.POSITION;
        const jointIndex = primitive.attributes?.JOINTS_0;
        const weightIndex = primitive.attributes?.WEIGHTS_0;
        assert.ok(Number.isInteger(positionIndex), `${context}: POSITION missing`);
        assert.ok(Number.isInteger(jointIndex), `${context}: JOINTS_0 missing`);
        assert.ok(Number.isInteger(weightIndex), `${context}: WEIGHTS_0 missing`);
        const positionAccessor = document.accessors[positionIndex];
        const jointAccessor = document.accessors[jointIndex];
        const weightAccessor = document.accessors[weightIndex];
        assert.equal(jointAccessor.type, 'VEC4', `${context}: JOINTS_0 must be VEC4`);
        assert.ok([5121, 5123].includes(jointAccessor.componentType), `${context}: invalid JOINTS_0 component type`);
        assert.equal(weightAccessor.type, 'VEC4', `${context}: WEIGHTS_0 must be VEC4`);
        assert.ok([5121, 5123, 5126].includes(weightAccessor.componentType), `${context}: invalid WEIGHTS_0 component type`);
        if (weightAccessor.componentType !== 5126) {
          assert.equal(weightAccessor.normalized, true, `${context}: integer weights must be normalized`);
        }
        assert.equal(jointAccessor.count, positionAccessor.count, `${context}: joint count must match positions`);
        assert.equal(weightAccessor.count, positionAccessor.count, `${context}: weight count must match positions`);

        const joints = decodeAccessor(document, binary, jointIndex, `${context} joints`);
        const weights = decodeAccessor(document, binary, weightIndex, `${context} weights`);
        for (let vertexIndex = 0; vertexIndex < positionAccessor.count; vertexIndex += 1) {
          const vertexJoints = joints[vertexIndex];
          const vertexWeights = weights[vertexIndex];
          assert.ok(vertexJoints.every(Number.isInteger), `${context}: non-integer joint index`);
          assert.ok(vertexWeights.every(Number.isFinite), `${context}: non-finite weight`);
          assert.ok(vertexWeights.every((weight) => weight >= 0), `${context}: negative weight`);
          const sum = vertexWeights.reduce((total, weight) => total + weight, 0);
          assert.ok(Math.abs(sum - 1) <= 1e-4, `${context}: vertex ${vertexIndex} weights sum to ${sum}`);
          for (let influence = 0; influence < vertexJoints.length; influence += 1) {
            if (vertexWeights[influence] <= 0) continue;
            const skinJointOffset = vertexJoints[influence];
            assert.ok(skinJointOffset < skin.joints.length, `${context}: joint index exceeds skin joint table`);
            usedJointIndices.add(skin.joints[skinJointOffset]);
          }
          weightedVertexCount += 1;
        }
        skinnedPrimitiveCount += 1;
      }
    }
    assert.ok(skinnedPrimitiveCount > 0, `${rig.id}: no skinned primitive found`);
    assert.ok(weightedVertexCount > 0, `${rig.id}: no weighted vertex found`);
    assert.ok(
      [...usedJointIndices].some((jointIndex) => !rootJointIndices.has(jointIndex)),
      `${rig.id}: every vertex is weighted only to Root`,
    );

    const animations = document.animations ?? [];
    assert.deepEqual(animations.map((animation) => animation.name).sort(), rig.clips);
    for (const animation of animations) {
      assert.ok(animation.channels.length > 0, `${rig.id}/${animation.name}: channels missing`);
      let changingNonRootChannel = false;
      for (const [channelIndex, channel] of animation.channels.entries()) {
        const context = `${rig.id}/${animation.name} channel ${channelIndex}`;
        assert.ok(allJointIndices.has(channel.target.node), `${context}: target is not a skin joint`);
        assert.ok(['translation', 'rotation', 'scale'].includes(channel.target.path), `${context}: invalid bone path`);
        const sampler = animation.samplers[channel.sampler];
        assert.ok(sampler, `${context}: sampler missing`);
        const times = decodeAccessor(document, binary, sampler.input, `${context} times`).flat();
        const rawValues = decodeAccessor(document, binary, sampler.output, `${context} values`);
        const interpolation = sampler.interpolation ?? 'LINEAR';
        const values = keyframeValues(rawValues, interpolation);
        assert.ok(times.length > 1, `${context}: animation needs more than one sample`);
        assert.equal(values.length, times.length, `${context}: sample/value count mismatch`);
        assert.ok(times.concat(rawValues.flat()).every(Number.isFinite), `${context}: non-finite animation data`);
        assert.ok(times.every((time, index) => index === 0 || time > times[index - 1]), `${context}: times must increase`);
        assert.ok(times.at(-1) > times[0], `${context}: zero-duration channel`);
        if (!rootJointIndices.has(channel.target.node) && tuplesDiffer(values)) {
          changingNonRootChannel = true;
        }
      }
      assert.ok(changingNonRootChannel, `${rig.id}/${animation.name}: no non-root joint actually changes`);
    }
  });
}
