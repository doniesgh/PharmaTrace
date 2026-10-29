// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @dev Vue minimale du contrat n°1 : uniquement ce dont le suivi a besoin.
interface IMedicineRegistry {
    enum Role { None, Pharmacy, Courier, Client }

    function roleOf(address user) external view returns (Role);
    function medicineCount() external view returns (uint256);
    function isExpired(uint256 id) external view returns (bool);
    function getMedicine(uint256 id) external view returns (
        string memory name,
        string memory batch,
        uint256 expiry,
        address pharmacy,
        uint256 price
    );
}

/// @title MedicineTracking (contrat n°2)
/// @notice Commande, livraison et paiement. Interroge le registre avant chaque écriture.
/// @dev Le paiement du client est bloqué dans le contrat jusqu'à la confirmation de réception,
///      puis réparti : 80 % pharmacie, 20 % livreur.
contract MedicineTracking {

    enum Status { Registered, Ordered, InDelivery, Delivered, ReceiptConfirmed }

    uint256 public constant PHARMACY_SHARE = 80; // en %, le livreur reçoit le reste (20 %)

    struct Tracking {
        Status status;
        address client;
        address courier;
        bool reported;      // un seul signalement par médicament
        uint256 paid;       // montant payé par le client (wei)
    }

    struct HistoryEntry {
        Status status;
        address author;
        uint256 timestamp;
    }

    struct Report {
        address author;
        string details;
        uint256 timestamp;
    }

    IMedicineRegistry public immutable registry;

    mapping(uint256 => Tracking) private trackings;
    mapping(uint256 => HistoryEntry[]) private histories;
    mapping(uint256 => Report[]) private reports;
    mapping(address => uint256) public balances; // gains retirables (pharmacies et livreurs)

    event StatusChanged(uint256 indexed id, Status status, address indexed author);
    event ProblemReported(uint256 indexed id, address indexed author, string details);
    event PaymentReleased(
        uint256 indexed id,
        address indexed pharmacy,
        uint256 pharmacyAmount,
        address indexed courier,
        uint256 courierAmount
    );
    event Withdrawn(address indexed user, uint256 amount);

    /// @param _registry adresse du contrat MedicineRegistry déjà déployé
    constructor(address _registry) {
        require(_registry != address(0), "Invalid registry");
        registry = IMedicineRegistry(_registry);
    }

    // ---------- Fonctions internes ----------

    function _checkExists(uint256 _id) internal view {
        require(_id > 0 && _id <= registry.medicineCount(), "Unknown medicine");
    }

    function _addHistory(uint256 _id, Status _status) internal {
        histories[_id].push(HistoryEntry(_status, msg.sender, block.timestamp));
        emit StatusChanged(_id, _status, msg.sender);
    }

    // ---------- Étapes du parcours ----------

    /// @notice Étape 1 : le client commande et paie le prix exact (bloqué dans le contrat).
    function order(uint256 _id) external payable {
        _checkExists(_id);
        require(registry.roleOf(msg.sender) == IMedicineRegistry.Role.Client, "Not a client");
        require(!registry.isExpired(_id), "Medicine expired");

        (, , , , uint256 price) = registry.getMedicine(_id);

        Tracking storage t = trackings[_id];
        require(t.status == Status.Registered && t.client == address(0), "Already ordered");
        require(msg.value == price, "Wrong payment amount");

        t.client = msg.sender;
        t.paid = msg.value;
        t.status = Status.Ordered;
        _addHistory(_id, Status.Ordered);
    }

    /// @notice Étape 2 : la pharmacie qui l'a enregistré l'envoie : elle le remet au livreur.
    function dispatch(uint256 _id, address _courier) external {
        _checkExists(_id);
        require(registry.roleOf(msg.sender) == IMedicineRegistry.Role.Pharmacy, "Not a pharmacy");

        (, , , address pharmacy, ) = registry.getMedicine(_id);
        require(pharmacy == msg.sender, "Not the registering pharmacy");

        Tracking storage t = trackings[_id];
        require(t.status == Status.Ordered, "Not ordered");

        require(registry.roleOf(_courier) == IMedicineRegistry.Role.Courier, "Invalid courier");

        t.courier = _courier;
        t.status = Status.InDelivery;
        _addHistory(_id, Status.InDelivery);
    }

    /// @notice Étape 3 : le livreur désigné livre.
    function deliver(uint256 _id) external {
        _checkExists(_id);
        Tracking storage t = trackings[_id];
        require(msg.sender == t.courier, "Not the designated courier");
        require(t.status == Status.InDelivery, "Not in delivery");

        t.status = Status.Delivered;
        _addHistory(_id, Status.Delivered);
    }

    /// @notice Étape 4 : le client confirme la réception, ce qui libère le paiement (80 % / 20 %).
    function confirmReceipt(uint256 _id) external {
        _checkExists(_id);
        Tracking storage t = trackings[_id];
        require(msg.sender == t.client, "Not the designated client");
        require(t.status == Status.Delivered, "Not delivered yet");

        t.status = Status.ReceiptConfirmed;
        _addHistory(_id, Status.ReceiptConfirmed);

        (, , , address pharmacy, ) = registry.getMedicine(_id);
        uint256 pharmacyAmount = (t.paid * PHARMACY_SHARE) / 100;
        uint256 courierAmount = t.paid - pharmacyAmount; // le reste, sans perte d'arrondi

        balances[pharmacy] += pharmacyAmount;
        balances[t.courier] += courierAmount;

        emit PaymentReleased(_id, pharmacy, pharmacyAmount, t.courier, courierAmount);
    }

    /// @notice La pharmacie ou le livreur retire ses gains.
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        balances[msg.sender] = 0; // on remet à zéro AVANT l'envoi (anti-réentrance)
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Le client désigné signale un problème (une seule fois).
    /// @dev Informe seulement : le statut ne change pas, rien n'est bloqué.
    function reportProblem(uint256 _id, string calldata _details) external {
        _checkExists(_id);
        Tracking storage t = trackings[_id];
        require(msg.sender == t.client, "Not the designated client");
        require(!t.reported, "Already reported");
        require(bytes(_details).length > 0, "Details empty");

        t.reported = true;
        reports[_id].push(Report(msg.sender, _details, block.timestamp));
        emit ProblemReported(_id, msg.sender, _details);
    }

    // ---------- Lectures ----------

    function getTracking(uint256 _id) external view returns (
        Status status, address client, address courier, bool reported, uint256 paid
    ) {
        _checkExists(_id);
        Tracking storage t = trackings[_id];
        return (t.status, t.client, t.courier, t.reported, t.paid);
    }

    function getHistory(uint256 _id) external view returns (HistoryEntry[] memory) {
        _checkExists(_id);
        return histories[_id];
    }

    function getReports(uint256 _id) external view returns (Report[] memory) {
        _checkExists(_id);
        return reports[_id];
    }
}
