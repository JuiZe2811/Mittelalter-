import * as THREE from 'three';

// Pfeil-Modell (für Spieler und Bogenschützen): Nocke im Ursprung, Spitze bei -Z
export const ARROW_LEN = 0.75;
const wood = new THREE.MeshLambertMaterial({ color: 0x8a6238 });
const iron = new THREE.MeshLambertMaterial({ color: 0x6a6e75 });
const shaftGeo = new THREE.CylinderGeometry(0.0045, 0.0045, ARROW_LEN, 6).rotateX(Math.PI / 2).translate(0, 0, -ARROW_LEN / 2);
const tipGeo = new THREE.ConeGeometry(0.012, 0.05, 6).rotateX(-Math.PI / 2).translate(0, 0, -ARROW_LEN - 0.02);
const featherGeo = new THREE.PlaneGeometry(0.02, 0.09);
const featherMats = [0xb02a20, 0xe8e0d0, 0x2a4a8a].map(c => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));
export function makeArrowMesh(color = 0) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(shaftGeo, wood), tip = new THREE.Mesh(tipGeo, iron);
  shaft.castShadow = true;
  g.add(shaft, tip);
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(featherGeo, featherMats[color % featherMats.length]);
    f.rotation.set(Math.PI / 2, i * Math.PI * 2 / 3, 0);
    f.position.set(Math.cos(i * 2.09) * 0.01, Math.sin(i * 2.09) * 0.01, -0.06);
    g.add(f);
  }
  return g;
}
