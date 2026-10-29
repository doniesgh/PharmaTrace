const MedicineRegistry = require("../build/contracts/MedicineRegistry.json") && artifacts.require("MedicineRegistry");
const MedicineTracking = artifacts.require("MedicineTracking");

module.exports = async function (deployer) {
    await deployer.deploy(MedicineRegistry);
    const registry = await MedicineRegistry.deployed();
    await deployer.deploy(MedicineTracking, registry.address);
};