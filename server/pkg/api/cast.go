package api

import (
	entity "github.com/ente-io/museum/ente/cast"
	"github.com/ente-io/museum/pkg/controller/cast"
	"net/http"
	"strconv"

	"github.com/ente-io/museum/ente"
	"github.com/ente-io/museum/pkg/controller"
	"github.com/ente-io/museum/pkg/utils/handler"
	"github.com/ente-io/stacktrace"
	"github.com/gin-gonic/gin"
)

// CastHandler exposes request handlers for publicly accessible collections
type CastHandler struct {
	FileCtrl       *controller.FileController
	CollectionCtrl *controller.CollectionController
	Ctrl           *cast.Controller
}

func (h *CastHandler) RegisterDevice(c *gin.Context) {
	var request entity.RegisterDeviceRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		handler.Error(c, stacktrace.Propagate(err, "failed to bind"))
		return
	}
	code, err := h.Ctrl.RegisterDevice(c, &request)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, "failed to register device"))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"deviceCode": code,
	})
}

func (h *CastHandler) GetDeviceInfo(c *gin.Context) {
	deviceCode := getDeviceCode(c)
	publicKey, err := h.Ctrl.GetPublicKey(c, deviceCode)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, "failed to get public key"))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"publicKey": publicKey,
	})
}

func (h *CastHandler) InsertCastData(c *gin.Context) {
	var request entity.CastRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		handler.Error(c, stacktrace.Propagate(err, "failed to bind"))
		return
	}
	err := h.Ctrl.InsertCastData(c, &request)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, "failed to start cast"))
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}

// RevokeAllToken disable all active cast token for a user
func (h *CastHandler) RevokeAllToken(c *gin.Context) {
	err := h.Ctrl.RevokeAllToken(c)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, "failed to start cast"))
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}

func (h *CastHandler) GetCastData(c *gin.Context) {
	deviceCode := getDeviceCode(c)
	encCastData, err := h.Ctrl.GetEncCastData(c, deviceCode)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, "failed to get encrypted payload"))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"encCastData": encCastData,
	})

}

// GetFile redirects the request to the file location
func (h *CastHandler) GetFile(c *gin.Context) {
	h.getFileForType(c, ente.FILE)
}

// GetThumbnail redirects the request to the file's thumbnail location
func (h *CastHandler) GetThumbnail(c *gin.Context) {
	h.getFileForType(c, ente.THUMBNAIL)
}

// GetCollection redirects the request to the collection location
func (h *CastHandler) GetCollection(c *gin.Context) {
	collection, err := h.CollectionCtrl.GetCastCollection(c)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"collection": collection,
	})
}

// GetDiff returns the diff within a collection since a timestamp
func (h *CastHandler) GetDiff(c *gin.Context) {
	sinceTime, err := strconv.ParseInt(c.Query("sinceTime"), 10, 64)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, ""))
		return
	}
	files, hasMore, err := h.CollectionCtrl.GetCastDiff(c, sinceTime)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"diff":    files,
		"hasMore": hasMore,
	})
}

func getDeviceCode(c *gin.Context) string {
	return c.Param("deviceCode")
}

func (h *CastHandler) getFileForType(c *gin.Context, objectType ente.ObjectType) {
	fileID, err := strconv.ParseInt(c.Param("fileID"), 10, 64)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(ente.ErrBadRequest, ""))
		return
	}
	url, err := h.FileCtrl.GetCastFileUrl(c, fileID, objectType)
	if err != nil {
		handler.Error(c, stacktrace.Propagate(err, ""))
		return
	}
	c.Redirect(http.StatusTemporaryRedirect, url)
}
