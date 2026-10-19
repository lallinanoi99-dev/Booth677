// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Booth 677 — keep a photo strip forever on BOT Chain.
/// @notice Private keepsakes store only the strip's SHA-256 fingerprint; public strips also store an IPFS CID
///         and appear on the Strip Wall. Nothing can be edited or deleted. No tokens, payments or admin.
contract Booth677 {
    struct Strip {
        address owner;
        bytes32 imageHash; // SHA-256 of the final PNG bytes
        string cid; // IPFS CID (public strips only, empty for private)
        uint8 frame;
        uint8 filter;
        uint8 shots;
        bool isPublic;
        uint32 hearts;
        uint64 at;
    }

    uint8 public constant FRAMES = 6; // Classic · 2×2 · Polaroid · Handheld · Negative · Postcard
    uint8 public constant FILTERS = 6; // Original · B&W · Sepia · Faded 90s · Cool Film · Warm Film
    uint8 public constant MAX_SHOTS = 4;
    uint256 public constant MAX_CID = 100;
    uint256 public constant MAX_PAGE = 100;

    Strip[] public strips;
    mapping(address => uint256[]) private byOwner;
    mapping(uint256 => mapping(address => bool)) public hearted;
    uint256[] private publicIds;
    mapping(bytes32 => uint256) private idPlusOneByHash; // 0 = not kept

    event Kept(uint256 indexed id, address indexed owner, bool isPublic);
    event Hearted(uint256 indexed id, address indexed by, uint32 hearts);

    error EmptyHash();
    error CidRequired();
    error CidNotAllowed();
    error CidTooLong();
    error BadFrame();
    error BadFilter();
    error BadShots();
    error AlreadyKept(uint256 id);
    error StripNotFound();
    error NotPublic();
    error AlreadyHearted();

    function keep(bytes32 imageHash, string calldata cid, uint8 frame, uint8 filter, uint8 shots, bool isPublic)
        external
        returns (uint256 id)
    {
        if (imageHash == bytes32(0)) revert EmptyHash();
        if (frame >= FRAMES) revert BadFrame();
        if (filter >= FILTERS) revert BadFilter();
        if (shots == 0 || shots > MAX_SHOTS) revert BadShots();
        uint256 cidLength = bytes(cid).length;
        if (isPublic) {
            if (cidLength == 0) revert CidRequired();
            if (cidLength > MAX_CID) revert CidTooLong();
        } else if (cidLength != 0) {
            revert CidNotAllowed();
        }
        uint256 existing = idPlusOneByHash[imageHash];
        if (existing != 0) revert AlreadyKept(existing - 1);

        id = strips.length;
        strips.push(Strip(msg.sender, imageHash, cid, frame, filter, shots, isPublic, 0, uint64(block.timestamp)));
        byOwner[msg.sender].push(id);
        idPlusOneByHash[imageHash] = id + 1;
        if (isPublic) publicIds.push(id);
        emit Kept(id, msg.sender, isPublic);
    }

    /// @notice One heart per wallet per public strip.
    function heart(uint256 id) external {
        if (id >= strips.length) revert StripNotFound();
        Strip storage s = strips[id];
        if (!s.isPublic) revert NotPublic();
        if (hearted[id][msg.sender]) revert AlreadyHearted();
        hearted[id][msg.sender] = true;
        uint32 hearts = s.hearts + 1;
        s.hearts = hearts;
        emit Hearted(id, msg.sender, hearts);
    }

    function getStrip(uint256 id) external view returns (Strip memory) {
        if (id >= strips.length) revert StripNotFound();
        return strips[id];
    }

    /// @notice Public strips in the order they were kept: positions [from, from + count) of the public list.
    function getPublic(uint256 from, uint256 count) external view returns (uint256[] memory ids, Strip[] memory list) {
        uint256 count_ = publicIds.length;
        if (count > MAX_PAGE) count = MAX_PAGE;
        uint256 end = from >= count_ ? from : (count_ - from < count ? count_ : from + count);
        uint256 n = end - from;
        ids = new uint256[](n);
        list = new Strip[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = publicIds[from + i];
            list[i] = strips[ids[i]];
        }
    }

    function stripsOf(address owner) external view returns (uint256[] memory) {
        return byOwner[owner];
    }

    /// @notice For "prove it's the original": re-hash the PNG and look it up.
    function findByHash(bytes32 imageHash) external view returns (bool found, uint256 id) {
        uint256 v = idPlusOneByHash[imageHash];
        return v == 0 ? (false, 0) : (true, v - 1);
    }

    function total() external view returns (uint256) {
        return strips.length;
    }

    function publicCount() external view returns (uint256) {
        return publicIds.length;
    }
}
