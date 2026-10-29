// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title MedicineRegistry (contrat n°1)
/// @notice Qui est inscrit, et quels médicaments existent (avec leur prix).
contract MedicineRegistry {

    // None = 0 : adresse non inscrite (valeur par défaut d'un mapping)
    enum Role { None, Pharmacy, Courier, Client }

    struct User {
        Role role;
        string name;
    }

    struct Medicine {
        string name;
        string batch;
        uint256 expiry;     // timestamp Unix (secondes)
        address pharmacy;   // pharmacie qui l'a enregistré
        uint256 price;      // prix en wei
    }

    mapping(address => User) private users;
    mapping(uint256 => Medicine) private medicines;
    uint256 private count;  // nombre de médicaments = dernier id (les ids commencent à 1)

    event UserRegistered(address indexed user, Role role, string name);
    event MedicineRegistered(
        uint256 indexed id,
        address indexed pharmacy,
        string name,
        string batch,
        uint256 price
    );

    // ---------- Comptes ----------

    /// @notice Tout le monde crée son compte avec le rôle choisi.
    function register(Role _role, string calldata _name) external {
        require(users[msg.sender].role == Role.None, "Already registered");
        require(bytes(_name).length > 0, "Name is empty");
        require(
            _role == Role.Pharmacy || _role == Role.Courier || _role == Role.Client,
            "Invalid role"
        );

        users[msg.sender] = User(_role, _name);
        emit UserRegistered(msg.sender, _role, _name);
    }

    function roleOf(address _user) external view returns (Role) {
        return users[_user].role;
    }

    function getUser(address _user) external view returns (Role role, string memory name) {
        User storage u = users[_user];
        return (u.role, u.name);
    }

    // ---------- Médicaments ----------

    /// @notice Une pharmacie crée la fiche d'un médicament (avec son prix) et reçoit son numéro.
    /// @param _price prix en wei (doit être > 0)
    function registerMedicine(
        string calldata _name,
        string calldata _batch,
        uint256 _expiry,
        uint256 _price
    ) external returns (uint256) {
        require(users[msg.sender].role == Role.Pharmacy, "Only a pharmacy");
        require(bytes(_name).length > 0 && bytes(_batch).length > 0, "Name or batch empty");
        require(_expiry > block.timestamp, "Already expired");
        require(_price > 0, "Price must be > 0");

        count++;
        medicines[count] = Medicine(_name, _batch, _expiry, msg.sender, _price);

        emit MedicineRegistered(count, msg.sender, _name, _batch, _price);
        return count;
    }

    function getMedicine(uint256 _id) external view returns (
        string memory name,
        string memory batch,
        uint256 expiry,
        address pharmacy,
        uint256 price
    ) {
        require(_id > 0 && _id <= count, "Unknown medicine");
        Medicine storage m = medicines[_id];
        return (m.name, m.batch, m.expiry, m.pharmacy, m.price);
    }

    function isExpired(uint256 _id) external view returns (bool) {
        require(_id > 0 && _id <= count, "Unknown medicine");
        return block.timestamp >= medicines[_id].expiry;
    }

    function medicineCount() external view returns (uint256) {
        return count;
    }
}
