// Addresses come from .env.local (NEXT_PUBLIC_*). ABIs below = the functions the app calls.
export const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS;
export const TRACKING_ADDRESS = process.env.NEXT_PUBLIC_TRACKING_ADDRESS;

export const REGISTRY_ABI = [
  "event UserRegistered(address indexed user, uint8 role, string name)",
  "event MedicineRegistered(uint256 indexed id, address indexed pharmacy, string name, string batch, uint256 price)",
  "function register(uint8 role, string name)",
  "function getUser(address) view returns (uint8 role, string name)",
  "function registerMedicine(string name, string batch, uint256 expiry, uint256 price) returns (uint256)",
  "function getMedicine(uint256) view returns (string name, string batch, uint256 expiry, address pharmacy, uint256 price)",
  "function isExpired(uint256) view returns (bool)",
  "function medicineCount() view returns (uint256)",
];

export const TRACKING_ABI = [
  "event StatusChanged(uint256 indexed id, uint8 status, address indexed author)",
  "event PaymentReleased(uint256 indexed id, address indexed pharmacy, uint256 pharmacyAmount, address indexed courier, uint256 courierAmount)",
  "function order(uint256 id) payable",
  "function dispatch(uint256 id, address courier)",
  "function deliver(uint256 id)",
  "function confirmReceipt(uint256 id)",
  "function withdraw()",
  "function reportProblem(uint256 id, string details)",
  "function balances(address) view returns (uint256)",
  "function PHARMACY_SHARE() view returns (uint256)",
  "function getTracking(uint256) view returns (uint8 status, address client, address courier, bool reported, uint256 paid)",
  "function getHistory(uint256) view returns (tuple(uint8 status, address author, uint256 timestamp)[])",
  "function getReports(uint256) view returns (tuple(address author, string details, uint256 timestamp)[])",
];

export const ROLES = ["", "Pharmacie", "Livreur", "Client"];
// L'ordre doit suivre l'enum Status du contrat : Registered, Ordered, InDelivery, Delivered, ReceiptConfirmed
export const STATUSES = ["Enregistré", "Commandé", "En livraison", "Livré", "Reçu confirmé"];